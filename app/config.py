from __future__ import annotations

import os
from pathlib import Path


class Settings:
    """Application configuration with sensible defaults for Raspberry Pi."""

    def __init__(self) -> None:
        base_dir = Path(os.getenv("APP_ROOT", Path(__file__).resolve().parent))
        self.media_dir: Path = Path(
            os.getenv("MEDIA_DIR", base_dir / "media")
        ).expanduser().resolve()
        self.media_dir.mkdir(parents=True, exist_ok=True)

        # Token is required for uploads; set via env or .env file
        self.upload_token: str | None = os.getenv("UPLOAD_TOKEN")

        # Limit accepted file extensions for the gallery
        default_exts = "jpg,jpeg,png,gif,webp,mp4,mov,mkv,avi"
        self.allowed_extensions = {
            f".{ext.lower().strip()}" for ext in os.getenv("ALLOWED_EXTENSIONS", default_exts).split(",")
        }

        # Maximum upload size in bytes (default 200MB for video)
        self.max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", 200 * 1024 * 1024))


settings = Settings()
