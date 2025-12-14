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
    Query,
    UploadFile,
)
from fastapi import Response
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
CATEGORY_STORE = settings.media_dir / "categories.json"


def verify_token(x_upload_token: Annotated[str | None, Header()] = None) -> None:
    if settings.upload_token is None:
        raise HTTPException(status_code=400, detail="UPLOAD_TOKEN not configured on server")
    if not secrets.compare_digest(x_upload_token or "", settings.upload_token):
        raise HTTPException(status_code=401, detail="Invalid upload token")


def is_allowed_file(filename: str) -> bool:
    return Path(filename.lower()).suffix in settings.allowed_extensions


def normalize_category(category: str | None) -> str | None:
    if category is None:
        return None
    cleaned = "".join(c for c in category if c.isalnum() or c in {"-", "_", " "})
    cleaned = cleaned.strip().replace(" ", "_")
    return cleaned or None


class Category(BaseModel):
    name: str
    slug: str
    created: str


class CategoryCreate(BaseModel):
    name: str


def load_categories() -> list[Category]:
    if not CATEGORY_STORE.exists():
        return []

    try:
        raw_data = json.loads(CATEGORY_STORE.read_text())
        if not isinstance(raw_data, list):
            return []
        return [Category(**item) for item in raw_data]
    except (json.JSONDecodeError, TypeError, ValueError):
        return []


def save_categories(categories: list[Category]) -> None:
    CATEGORY_STORE.parent.mkdir(parents=True, exist_ok=True)
    CATEGORY_STORE.write_text(
        json.dumps([category.model_dump() for category in categories], indent=2)
    )


def category_lookup(categories: list[Category]) -> dict[str, Category]:
    return {category.slug: category for category in categories}


@app.get("/api/categories")
def list_categories() -> list[dict[str, str]]:
    categories = sorted(load_categories(), key=lambda category: category.name.lower())
    return [category.model_dump() for category in categories]


@app.post("/api/categories", status_code=201)
def create_category(category: CategoryCreate) -> dict[str, str]:
    normalized = normalize_category(category.name)
    if normalized is None:
        raise HTTPException(status_code=400, detail="Invalid category name")

    categories = load_categories()
    if normalized in category_lookup(categories):
        raise HTTPException(status_code=409, detail="Category already exists")

    new_category = Category(
        name=category.name.strip() or normalized,
        slug=normalized,
        created=datetime.utcnow().isoformat(),
    )
    categories.append(new_category)
    save_categories(categories)
    return new_category.model_dump()


@app.delete("/api/categories/{category_slug}", status_code=204)
def delete_category(category_slug: str) -> Response:
    normalized = normalize_category(category_slug)
    if normalized is None:
        raise HTTPException(status_code=404, detail="Category not found")

    categories = load_categories()
    updated_categories = [category for category in categories if category.slug != normalized]
    if len(updated_categories) == len(categories):
        raise HTTPException(status_code=404, detail="Category not found")

    save_categories(updated_categories)
    return Response(status_code=204)


@app.get("/api/media")
def list_media(
    category: Annotated[str | None, Query(alias="category")] = None,
) -> list[dict[str, str | int | None]]:
    filter_category = normalize_category(category)
    categories = category_lookup(load_categories())
    items: list[dict[str, str | int]] = []
    for file_path in sorted(settings.media_dir.rglob("*")):
        if not file_path.is_file() or not is_allowed_file(file_path.name):
            continue
        relative_path = file_path.relative_to(settings.media_dir)
        item_category = relative_path.parts[0] if len(relative_path.parts) > 1 else None
        if filter_category is not None and filter_category != item_category:
            continue
        stat = file_path.stat()
        mime_type, _ = mimetypes.guess_type(file_path.name)
        category_meta = categories.get(item_category) if item_category else None
        category_label = category_meta.name if category_meta else item_category
        items.append(
            {
                "name": file_path.name,
                "path": str(relative_path),
                "category": category_label,
                "category_slug": item_category,
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
    file: Annotated[UploadFile, File(...)],
    category: Annotated[str | None, Form()] = None,
    _: None = Depends(verify_token),
) -> dict[str, str | None]:
    if not is_allowed_file(file.filename):
        raise HTTPException(status_code=400, detail="File type not allowed")

    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    safe_category = normalize_category(category)
    target_dir = settings.media_dir / safe_category if safe_category else settings.media_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    target_path = target_dir / file.filename
    counter = 1
    while target_path.exists():
        stem = Path(file.filename).stem
        suffix = Path(file.filename).suffix
        target_path = target_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    with target_path.open("wb") as buffer:
        buffer.write(data)

    return {
        "message": "Uploaded",
        "path": str(target_path.relative_to(settings.media_dir)),
        "category": safe_category,
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
