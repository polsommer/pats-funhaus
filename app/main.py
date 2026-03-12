from __future__ import annotations

import json
import mimetypes
import secrets
from urllib.parse import urlparse
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import (
    BackgroundTasks,
    Body,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    Query,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .media_processing import MediaProcessor
from .upscale.jobs import job_manager
from .upscale.models import (
    UPSCALE_PROFILE_LABELS,
    UpscaleProfileOption,
    UpscaleProfilesResponse,
    UpscaleRequest,
    UpscaleStatusResponse,
    UpscaleSubmitResponse,
)

app = FastAPI(title="Pi Media Gallery", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/derivatives", StaticFiles(directory=settings.derivatives_dir), name="derivatives")

media_processor = MediaProcessor(
    media_dir=settings.media_dir,
    derivatives_dir=settings.derivatives_dir,
    enable_video_derivatives=settings.enable_video_derivatives,
    max_derivative_width=settings.max_derivative_width,
    target_video_bitrate=settings.target_video_bitrate,
)


def verify_token(x_upload_token: Annotated[str | None, Header()] = None) -> None:
    if settings.upload_token is None:
        raise HTTPException(status_code=400, detail="UPLOAD_TOKEN not configured on server")
    if not secrets.compare_digest(x_upload_token or "", settings.upload_token):
        raise HTTPException(status_code=401, detail="Invalid upload token")


def is_allowed_file(filename: str) -> bool:
    return Path(filename.lower()).suffix in settings.allowed_extensions


def normalize_category(category: str | None) -> str | None:
    return settings.normalize_category(category)


class Category(BaseModel):
    name: str
    path: str


class CategoryStore:
    def __init__(self, store_path: Path, initial_map: dict[str, str]):
        self.store_path = store_path
        self.categories: list[Category] = []
        self._load(initial_map)

    def _load(self, initial_map: dict[str, str]) -> None:
        if self.store_path.exists():
            with self.store_path.open("r", encoding="utf-8") as file:
                raw_categories = json.load(file)
                self.categories = [Category(**item) for item in raw_categories]
        else:
            self.categories = [
                Category(name=name, path=path) for name, path in initial_map.items()
            ]
            self._persist()

    def _persist(self) -> None:
        temp_path = self.store_path.with_suffix(self.store_path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump([category.model_dump() for category in self.categories], file, indent=2)
        temp_path.replace(self.store_path)

    def list(self) -> list[Category]:
        return list(self.categories)

    def get_by_name(self, name: str) -> Category | None:
        normalized_name = normalize_category(name)
        if normalized_name is None:
            return None
        for category in self.categories:
            if category.name == normalized_name:
                return category
        return None

    def get_by_path(self, path: str | None) -> Category | None:
        if path is None:
            return None
        normalized_path = normalize_category(path)
        for category in self.categories:
            if category.path == normalized_path:
                return category
        return None

    def add(self, name: str, path: str | None = None) -> Category:
        normalized_name = normalize_category(name)
        if normalized_name is None:
            raise ValueError("Invalid category name")

        normalized_path = normalize_category(path or normalized_name)
        if normalized_path is None:
            raise ValueError("Invalid category path")

        if self.get_by_name(normalized_name):
            raise ValueError("Category name already exists")
        if self.get_by_path(normalized_path):
            raise ValueError("Category path already exists")

        new_category = Category(name=normalized_name, path=normalized_path)
        self.categories.append(new_category)
        self._persist()
        return new_category

    def delete(self, name: str) -> Category:
        normalized_name = normalize_category(name)
        if normalized_name is None:
            raise KeyError("Category not found")

        for index, category in enumerate(self.categories):
            if category.name == normalized_name:
                removed_category = self.categories.pop(index)
                self._persist()
                return removed_category
        raise KeyError("Category not found")

    def update(self, name: str, new_name: str | None, new_path: str | None) -> Category:
        normalized_current = normalize_category(name)
        if normalized_current is None:
            raise KeyError("Category not found")

        category = self.get_by_name(normalized_current)
        if category is None:
            raise KeyError("Category not found")

        candidate_name = normalize_category(new_name) if new_name is not None else category.name
        candidate_path = normalize_category(new_path) if new_path is not None else category.path

        if candidate_name is None or candidate_path is None:
            raise ValueError("Invalid category name or path")

        for existing in self.categories:
            if existing is category:
                continue
            if existing.name == candidate_name:
                raise ValueError("Category name already exists")
            if existing.path == candidate_path:
                raise ValueError("Category path already exists")

        category.name = candidate_name
        category.path = candidate_path
        self._persist()
        return category


category_store = CategoryStore(settings.category_store_path, settings.category_map)


class Link(BaseModel):
    id: str
    name: str
    url: str
    domain: str
    category: str | None = None
    category_path: str | None = None
    added: str


class LinkStore:
    def __init__(self, store_path: Path):
        self.store_path = store_path
        self.links: list[Link] = []
        self._load()

    def _load(self) -> None:
        if not self.store_path.exists():
            self.links = []
            return

        with self.store_path.open("r", encoding="utf-8") as file:
            raw_links = json.load(file)
            self.links = [Link(**item) for item in raw_links]

    def _persist(self) -> None:
        temp_path = self.store_path.with_suffix(self.store_path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump([link.model_dump() for link in self.links], file, indent=2)
        temp_path.replace(self.store_path)

    def list(self) -> list[Link]:
        return list(self.links)

    def _validate_url(self, url: str) -> tuple[str, str]:
        parsed = urlparse(url.strip())
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Provide a valid https URL")
        return parsed.geturl(), parsed.netloc

    def _resolve_category(self, category: str | None) -> tuple[str | None, str | None]:
        normalized = normalize_category(category)
        if normalized is None:
            return None, None

        category_record = category_store.get_by_name(normalized) or category_store.get_by_path(normalized)
        if category_record is None:
            raise ValueError("Unknown category")
        return category_record.name, category_record.path

    def add(self, url: str, name: str | None = None, category: str | None = None) -> Link:
        clean_url, domain = self._validate_url(url)
        resolved_category, resolved_path = self._resolve_category(category)

        if any(link.url == clean_url for link in self.links):
            raise ValueError("Link already added")

        link = Link(
            id=secrets.token_hex(8),
            name=name.strip() if name and name.strip() else domain,
            url=clean_url,
            domain=domain,
            category=resolved_category,
            category_path=resolved_path,
            added=datetime.utcnow().isoformat(),
        )
        self.links.append(link)
        self._persist()
        return link

    def delete(self, link_id: str) -> Link:
        for index, link in enumerate(self.links):
            if link.id == link_id:
                removed = self.links.pop(index)
                self._persist()
                return removed
        raise KeyError("Link not found")


link_store = LinkStore(settings.link_store_path)


class CreateCategoryRequest(BaseModel):
    name: str
    path: str | None = None


class UpdateCategoryRequest(BaseModel):
    name: str | None = None
    path: str | None = None


class CreateLinkRequest(BaseModel):
    url: str
    name: str | None = None
    category: str | None = None


class UpdateMediaCategoryRequest(BaseModel):
    path: str
    category: str | None = None


@app.get("/api/media")
def list_media(
    category: Annotated[str | None, Query(alias="category")] = None,
) -> list[dict[str, str | int | None]]:
    filter_category = normalize_category(category)
    items: list[dict[str, str | int | None]] = []
    for file_path in sorted(settings.media_dir.rglob("*")):
        if settings.derivatives_dir in file_path.parents:
            continue
        if not file_path.is_file() or not is_allowed_file(file_path.name):
            continue
        relative_path = file_path.relative_to(settings.media_dir)
        category_path = relative_path.parts[0] if len(relative_path.parts) > 1 else None
        category_meta = category_store.get_by_path(category_path)
        item_category = category_meta.name if category_meta else category_path

        if filter_category is not None and filter_category != item_category:
            continue
        stat = file_path.stat()
        mime_type, _ = mimetypes.guess_type(file_path.name)
        derivative_meta = media_processor.load_metadata(relative_path) or {}
        items.append(
            {
                "name": file_path.name,
                "path": str(relative_path),
                "category": item_category,
                "category_path": category_path,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "mime_type": mime_type or "application/octet-stream",
                "url": f"/media/{relative_path}",
                "preview_url": derivative_meta.get("preview_url"),
                "thumbnail_url": derivative_meta.get("thumbnail_url"),
                "poster": derivative_meta.get("poster"),
                "stream_url": derivative_meta.get("stream_url"),
                "source": "file",
            }
        )

    for link in link_store.list():
        if filter_category is not None and filter_category != link.category:
            continue

        items.append(
            {
                "id": link.id,
                "name": link.name,
                "path": f"link:{link.id}",
                "category": link.category,
                "category_path": link.category_path,
                "size": None,
                "modified": link.added,
                "mime_type": "text/html",
                "url": link.url,
                "preview_url": None,
                "thumbnail_url": None,
                "poster": None,
                "stream_url": None,
                "source": "link",
                "domain": link.domain,
            }
        )
    items.sort(key=lambda item: item["modified"], reverse=True)
    return items


@app.get("/media/{media_path:path}")
def serve_media(media_path: str) -> FileResponse:
    requested_path = (settings.media_dir / media_path).resolve()
    if not requested_path.is_file() or settings.media_dir not in requested_path.parents:
        raise HTTPException(status_code=404, detail="Media not found")

    media_type, _ = mimetypes.guess_type(str(requested_path))
    return FileResponse(requested_path, media_type=media_type)


@app.post("/api/media", status_code=201)
def upload_media(
    background_tasks: BackgroundTasks,
    response: Response,
    files: Annotated[list[UploadFile], File(...)],
    category: Annotated[str | None, Form()] = None,
    _: None = Depends(verify_token),
) -> dict[str, str | dict[str, str] | list[dict[str, str | None]] | None]:
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    safe_category = normalize_category(category)
    category_record = category_store.get_by_name(safe_category) if safe_category else None
    if safe_category is not None and category_record is None:
        raise HTTPException(status_code=400, detail="Unknown category")

    category_path = category_record.path if category_record else None
    target_dir = settings.media_dir / category_path if category_path else settings.media_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, str | None]] = []

    for upload in files:
        results.append(process_upload_file(upload, target_dir, background_tasks))

    has_success = any(result.get("status") == "success" for result in results)
    has_failure = any(result.get("status") == "error" for result in results)
    if has_success and has_failure:
        response.status_code = 207  # Multi-Status
    elif has_success:
        response.status_code = 201
    else:
        response.status_code = 207

    return {
        "message": "Uploaded" if has_success else "Upload failed",
        "category": {"name": safe_category, "path": category_path} if safe_category else None,
        "results": results,
    }


def process_upload_file(
    upload: UploadFile,
    target_dir: Path,
    background_tasks: BackgroundTasks,
) -> dict[str, str | None]:
    if not upload.filename:
        return {"name": "", "status": "error", "message": "Filename is required", "path": None}

    if not is_allowed_file(upload.filename):
        return {
            "name": upload.filename,
            "status": "error",
            "message": "File type not allowed",
            "path": None,
        }

    target_path = _resolve_target_path(upload.filename, target_dir)

    try:
        _stream_to_disk(upload, target_path)
    except HTTPException as error:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        return {
            "name": upload.filename,
            "status": "error",
            "message": error.detail if isinstance(error.detail, str) else "Upload failed",
            "path": None,
        }
    except Exception:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        return {
            "name": upload.filename,
            "status": "error",
            "message": "Upload failed",
            "path": None,
        }

    relative_path = target_path.relative_to(settings.media_dir)
    file_size = target_path.stat().st_size
    if file_size > 25 * 1024 * 1024:
        background_tasks.add_task(media_processor.generate_for_relative_path, relative_path)
    else:
        media_processor.generate_for_relative_path(relative_path)

    return {
        "name": upload.filename,
        "status": "success",
        "message": "Uploaded",
        "path": str(relative_path),
    }


def _stream_to_disk(upload: UploadFile, target_path: Path, chunk_size: int = 1024 * 1024) -> None:
    total_bytes = 0
    with target_path.open("wb") as buffer:
        while True:
            chunk = upload.file.read(chunk_size)
            if not chunk:
                break
            total_bytes += len(chunk)
            if settings.max_upload_bytes > 0 and total_bytes > settings.max_upload_bytes:
                raise HTTPException(status_code=413, detail="File too large")
            buffer.write(chunk)


def _resolve_target_path(filename: str, target_dir: Path) -> Path:
    safe_name = Path(filename).name
    safe_path = Path(safe_name)

    if safe_name != filename or not safe_name or not safe_path.stem:
        raise HTTPException(
            status_code=400,
            detail="Filename cannot contain path separators and must include a name",
        )

    target_dir = target_dir.resolve()
    stem = safe_path.stem
    suffix = safe_path.suffix

    counter = 0
    while True:
        candidate_name = safe_name if counter == 0 else f"{stem}_{counter}{suffix}"
        candidate_path = (target_dir / candidate_name).resolve()

        try:
            candidate_path.relative_to(settings.media_dir)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Path must be inside media directory") from error

        if not candidate_path.exists():
            return candidate_path

        counter += 1


def _validate_media_path(relative_path: str) -> Path:
    if not relative_path:
        raise HTTPException(status_code=400, detail="Path is required")

    target_path = (settings.media_dir / relative_path).resolve()

    try:
        target_path.relative_to(settings.media_dir)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Path must be inside media directory") from error

    if not is_allowed_file(target_path.name):
        raise HTTPException(status_code=400, detail="File type not allowed")

    return target_path


def _is_link_path(path: str) -> bool:
    return path.startswith("link:")


def _resolve_category_record(category: str | None) -> Category | None:
    normalized = normalize_category(category)
    if normalized is None:
        return None

    category_record = category_store.get_by_name(normalized) or category_store.get_by_path(normalized)
    if category_record is None:
        raise HTTPException(status_code=400, detail="Unknown category")
    return category_record


def _update_link_category(link_path: str, category_record: Category | None) -> dict[str, str | None]:
    link_id = link_path.split(":", 1)[-1]
    for link in link_store.links:
        if link.id != link_id:
            continue

        link.category = category_record.name if category_record else None
        link.category_path = category_record.path if category_record else None
        link_store._persist()
        return {
            "message": "Updated",
            "path": link_path,
            "category": link.category,
            "category_path": link.category_path,
        }

    raise HTTPException(status_code=404, detail="Link not found")


def _update_file_category(raw_path: str, category_record: Category | None) -> dict[str, str | None]:
    target_path = _validate_media_path(raw_path)
    if not target_path.is_file():
        raise HTTPException(status_code=404, detail="Media not found")

    destination_dir = settings.media_dir / category_record.path if category_record else settings.media_dir
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination_path = _resolve_target_path(target_path.name, destination_dir)

    if destination_path == target_path:
        relative = target_path.relative_to(settings.media_dir)
        return {
            "message": "Updated",
            "path": str(relative),
            "category": category_record.name if category_record else None,
            "category_path": category_record.path if category_record else None,
        }

    old_relative = target_path.relative_to(settings.media_dir)
    target_path.replace(destination_path)
    new_relative = destination_path.relative_to(settings.media_dir)

    media_processor.delete_for_relative_path(old_relative)
    media_processor.generate_for_relative_path(new_relative)

    return {
        "message": "Updated",
        "path": str(new_relative),
        "category": category_record.name if category_record else None,
        "category_path": category_record.path if category_record else None,
    }


def _reassign_media_category(path: str, category: str | None) -> dict[str, str | None]:
    category_record = _resolve_category_record(category)
    if _is_link_path(path):
        return _update_link_category(path, category_record)
    return _update_file_category(path, category_record)


def _delete_link_by_path(link_path: str) -> dict[str, str]:
    link_id = link_path.split(":", 1)[-1]
    try:
        link_store.delete(link_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"message": "Deleted", "path": link_path}


@app.delete("/api/media")
def delete_media(
    path: Annotated[str, Query(alias="path")],
    _: None = Depends(verify_token),
) -> dict[str, str]:
    if _is_link_path(path):
        return _delete_link_by_path(path)

    target_path = _validate_media_path(path)

    if not target_path.is_file():
        raise HTTPException(status_code=404, detail="Media not found")

    target_path.unlink()
    media_processor.delete_for_relative_path(target_path.relative_to(settings.media_dir))
    return {"message": "Deleted", "path": str(target_path.relative_to(settings.media_dir))}


@app.delete("/api/media/batch")
def delete_media_batch(
    payload: Annotated[list[str], Body(..., embed=False)],
    response: Response,
    _: None = Depends(verify_token),
) -> dict[str, list[dict[str, str | int]]]:
    if not isinstance(payload, list) or not payload:
        raise HTTPException(status_code=400, detail="Provide at least one path to delete")

    results: list[dict[str, str | int]] = []

    for raw_path in payload:
        if _is_link_path(raw_path):
            try:
                deleted = _delete_link_by_path(raw_path)
                results.append(
                    {
                        "path": deleted.get("path", raw_path),
                        "status": "success",
                        "message": deleted.get("message", "Deleted"),
                        "code": 200,
                    }
                )
            except HTTPException as error:
                results.append(
                    {
                        "path": raw_path,
                        "status": "error",
                        "message": error.detail if isinstance(error.detail, str) else "Invalid path",
                        "code": error.status_code,
                    }
                )
            continue

        try:
            target_path = _validate_media_path(raw_path)
        except HTTPException as error:
            results.append(
                {
                    "path": raw_path,
                    "status": "error",
                    "message": error.detail if isinstance(error.detail, str) else "Invalid path",
                    "code": error.status_code,
                }
            )
            continue

        if not target_path.is_file():
            results.append(
                {
                    "path": raw_path,
                    "status": "error",
                    "message": "Media not found",
                    "code": 404,
                }
            )
            continue

        try:
            target_path.unlink()
            media_processor.delete_for_relative_path(target_path.relative_to(settings.media_dir))
            results.append(
                {
                    "path": str(target_path.relative_to(settings.media_dir)),
                    "status": "success",
                    "message": "Deleted",
                    "code": 200,
                }
            )
        except Exception:
            results.append(
                {
                    "path": raw_path,
                    "status": "error",
                    "message": "Failed to delete file",
                    "code": 500,
                }
            )

    has_success = any(result.get("status") == "success" for result in results)
    errors = [result for result in results if result.get("status") == "error"]

    if has_success and errors:
        response.status_code = 207
    elif has_success:
        response.status_code = 200
    else:
        codes = {result.get("code") for result in results if result.get("code")}
        if codes == {404}:
            response.status_code = 404
        elif codes:
            response.status_code = min(codes)
        else:
            response.status_code = 400

    return {"results": results}


@app.patch("/api/media/category")
def update_media_category(
    payload: UpdateMediaCategoryRequest,
    _: None = Depends(verify_token),
) -> dict[str, str | None]:
    return _reassign_media_category(payload.path, payload.category)




@app.get("/api/upscale/profiles", response_model=UpscaleProfilesResponse)
def list_upscale_profiles() -> UpscaleProfilesResponse:
    profiles = [
        UpscaleProfileOption(key=key, label=label)
        for key, label in UPSCALE_PROFILE_LABELS.items()
    ]
    return UpscaleProfilesResponse(profiles=profiles)


@app.post("/api/upscale", response_model=UpscaleSubmitResponse, status_code=202)
def submit_upscale_job(payload: UpscaleRequest, _: None = Depends(verify_token)) -> UpscaleSubmitResponse:
    job = job_manager.submit(payload)
    return UpscaleSubmitResponse(job_id=job.id, state=job.state)


@app.get("/api/upscale/{job_id}", response_model=UpscaleStatusResponse)
def get_upscale_job(job_id: str) -> UpscaleStatusResponse:
    job = job_manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return UpscaleStatusResponse(job=job)


@app.get("/api/upscale", response_model=list[UpscaleStatusResponse])
def list_upscale_jobs(limit: Annotated[int, Query(ge=1, le=100)] = 30) -> list[UpscaleStatusResponse]:
    return [UpscaleStatusResponse(job=job) for job in job_manager.list_recent(limit=limit)]


@app.delete("/api/upscale/{job_id}", response_model=UpscaleStatusResponse)
def cancel_upscale_job(job_id: str, _: None = Depends(verify_token)) -> UpscaleStatusResponse:
    try:
        job = job_manager.cancel(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return UpscaleStatusResponse(job=job)


@app.get("/api/categories")
def list_categories() -> list[Category]:
    return category_store.list()


@app.post("/api/categories", status_code=201)
def create_category(payload: CreateCategoryRequest, _: None = Depends(verify_token)) -> Category:
    try:
        return category_store.add(payload.name, payload.path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.delete("/api/categories/{name}")
def delete_category(name: str, _: None = Depends(verify_token)) -> Category:
    try:
        return category_store.delete(name)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.patch("/api/categories/{name}")
def update_category(
    name: str,
    payload: UpdateCategoryRequest,
    _: None = Depends(verify_token),
) -> Category:
    if payload.name is None and payload.path is None:
        raise HTTPException(status_code=400, detail="No updates provided")

    try:
        return category_store.update(name, payload.name, payload.path)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/links")
def list_links() -> list[Link]:
    return link_store.list()


@app.post("/api/links", status_code=201)
def create_link(payload: CreateLinkRequest, _: None = Depends(verify_token)) -> Link:
    try:
        return link_store.add(payload.url, payload.name, payload.category)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.delete("/api/links/{link_id}")
def delete_link(link_id: str, _: None = Depends(verify_token)) -> Link:
    try:
        return link_store.delete(link_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
