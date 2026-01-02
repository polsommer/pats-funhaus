from __future__ import annotations

import os
from pathlib import Path
from typing import Dict


class Settings:
    """Application configuration with sensible defaults for Raspberry Pi."""

    def __init__(self) -> None:
        base_dir = Path(os.getenv("APP_ROOT", Path(__file__).resolve().parent))
        self.media_dir: Path = Path(
            os.getenv("MEDIA_DIR", base_dir / "media")
        ).expanduser().resolve()
        self.media_dir.mkdir(parents=True, exist_ok=True)

        # Limit accepted file extensions for the gallery
        default_exts = "jpg,jpeg,png,gif,webp,mp4,mov,mkv,avi"
        self.allowed_extensions = {
            f".{ext.lower().strip()}" for ext in os.getenv("ALLOWED_EXTENSIONS", default_exts).split(",")
        }

        # Managed categories map to directories ("label:path" pairs separated by commas)
        raw_categories = os.getenv("MEDIA_CATEGORIES")
        self.category_map: Dict[str, str] = self._load_categories(raw_categories)
        self.category_paths: Dict[str, str] = {path: name for name, path in self.category_map.items()}

        self.category_store_path: Path = Path(
            os.getenv("CATEGORY_STORE", base_dir / "categories.json")
        ).expanduser().resolve()
        self.category_store_path.parent.mkdir(parents=True, exist_ok=True)

        self.link_store_path: Path = Path(
            os.getenv("LINK_STORE", base_dir / "links.json")
        ).expanduser().resolve()
        self.link_store_path.parent.mkdir(parents=True, exist_ok=True)

        self.login_username: str = os.getenv("LOGIN_USERNAME", "family")
        self.login_password: str = os.getenv("LOGIN_PASSWORD", "welcome-home")
        self.auth_db_host: str = os.getenv("AUTH_DB_HOST", "127.0.0.1")
        self.auth_db_port: int = int(os.getenv("AUTH_DB_PORT", "3306"))
        self.auth_db_user: str = os.getenv("AUTH_DB_USER", "admin")
        self.auth_db_password: str = os.getenv("AUTH_DB_PASSWORD", "strongpassword")
        self.auth_db_name: str = os.getenv("AUTH_DB_NAME", "family_gallery")

        # Maximum upload size in bytes (default 200MB for video)
        self.max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", 200 * 1024 * 1024))

    @staticmethod
    def normalize_category(category: str | None) -> str | None:
        if category is None:
            return None
        cleaned = "".join(c for c in category if c.isalnum() or c in {"-", "_", " "})
        cleaned = cleaned.strip().replace(" ", "_")
        return cleaned or None

    def _load_categories(self, raw: str | None) -> Dict[str, str]:
        if not raw:
            return {}

        mapping: Dict[str, str] = {}
        for entry in raw.split(","):
            if not entry.strip():
                continue

            if ":" in entry:
                name, path = entry.split(":", 1)
            else:
                name = path = entry

            clean_name = self.normalize_category(name)
            clean_path = self.normalize_category(path)

            if not clean_name or not clean_path:
                continue

            mapping[clean_name] = clean_path

        return mapping


settings = Settings()
