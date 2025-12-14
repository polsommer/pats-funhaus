from __future__ import annotations

import json
import mimetypes
import secrets
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import (
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


category_store = CategoryStore(settings.category_store_path, settings.category_map)


class CreateCategoryRequest(BaseModel):
    name: str
    path: str | None = None


@app.get("/api/media")
def list_media(
    category: Annotated[str | None, Query(alias="category")] = None,
) -> list[dict[str, str | int | None]]:
    filter_category = normalize_category(category)
    items: list[dict[str, str | int]] = []
    for file_path in sorted(settings.media_dir.rglob("*")):
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
        results.append(process_upload_file(upload, target_dir))

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


def process_upload_file(upload: UploadFile, target_dir: Path) -> dict[str, str | None]:
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

    return {
        "name": upload.filename,
        "status": "success",
        "message": "Uploaded",
        "path": str(target_path.relative_to(settings.media_dir)),
    }


def _stream_to_disk(upload: UploadFile, target_path: Path, chunk_size: int = 1024 * 1024) -> None:
    total_bytes = 0
    with target_path.open("wb") as buffer:
        while True:
            chunk = upload.file.read(chunk_size)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > settings.max_upload_bytes:
                raise HTTPException(status_code=413, detail="File too large")
            buffer.write(chunk)


def _resolve_target_path(filename: str, target_dir: Path) -> Path:
    target_path = target_dir / filename
    counter = 1
    while target_path.exists():
        stem = Path(filename).stem
        suffix = Path(filename).suffix
        target_path = target_dir / f"{stem}_{counter}{suffix}"
        counter += 1
    return target_path


@app.get("/api/categories")
def list_categories() -> list[Category]:
    return category_store.list()


@app.post("/api/categories", status_code=201)
def create_category(payload: CreateCategoryRequest) -> Category:
    try:
        return category_store.add(payload.name, payload.path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.delete("/api/categories/{name}")
def delete_category(name: str) -> Category:
    try:
        return category_store.delete(name)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
