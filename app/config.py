from __future__ import annotations

import json
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

        self.derivatives_dir: Path = Path(
            os.getenv("DERIVATIVES_DIR", self.media_dir / ".derivatives")
        ).expanduser().resolve()
        self.derivatives_dir.mkdir(parents=True, exist_ok=True)

        self.enable_video_derivatives: bool = os.getenv("ENABLE_VIDEO_DERIVATIVES", "true").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.max_derivative_width: int = int(os.getenv("MAX_DERIVATIVE_WIDTH", "1280"))
        self.target_video_bitrate: str = os.getenv("TARGET_VIDEO_BITRATE", "2500k")

        # Token is required for uploads; set via env or .env file
        self.upload_token: str | None = os.getenv("UPLOAD_TOKEN")

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

        # Maximum upload size in bytes. Set to 0 or a negative value for no limit.
        self.max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", "0"))

        # Optional AI upscaler configuration
        self.enable_ai_upscaler: bool = os.getenv("ENABLE_AI_UPSCALER", "false").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.upscaler_backend: str = os.getenv("UPSCALER_BACKEND", "none")
        self.upscaler_image_backend: str = os.getenv("UPSCALER_IMAGE_BACKEND", self.upscaler_backend)
        self.upscaler_video_backend: str = os.getenv("UPSCALER_VIDEO_BACKEND", self.upscaler_backend)
        self.upscaler_model_path: str | None = os.getenv("UPSCALER_MODEL_PATH")
        self.upscaler_use_gpu: bool = os.getenv("UPSCALER_USE_GPU", "false").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.upscaler_force_cpu: bool = os.getenv("UPSCALER_FORCE_CPU", "true").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.upscaler_worker_concurrency: int = int(os.getenv("UPSCALER_WORKER_CONCURRENCY", "1"))

        self.upscaled_media_dir: Path = Path(
            os.getenv("UPSCALER_OUTPUT_DIR", self.media_dir / "upscaled")
        ).expanduser().resolve()
        self.upscaled_media_dir.mkdir(parents=True, exist_ok=True)
        self.upscaler_output_mode: str = os.getenv("UPSCALER_OUTPUT_MODE", "tree")

        allowed_mimes = os.getenv("UPSCALER_ALLOWED_MIME_PREFIXES", "image/,video/")
        self.upscaler_allowed_mime_prefixes: tuple[str, ...] = tuple(
            prefix.strip().lower() for prefix in allowed_mimes.split(",") if prefix.strip()
        )
        self.upscaler_max_input_bytes: int = int(os.getenv("UPSCALER_MAX_INPUT_BYTES", str(80 * 1024 * 1024)))
        self.upscaler_max_video_seconds: int = int(os.getenv("UPSCALER_MAX_VIDEO_SECONDS", "120"))
        self.upscaler_video_bytes_per_second: int = int(
            os.getenv("UPSCALER_VIDEO_BYTES_PER_SECOND", str(1_000_000))
        )

        self.upscaler_video_bitrate_targets: Dict[str, str] = self._load_json_map(
            os.getenv("UPSCALER_VIDEO_BITRATE_TARGETS"),
            {
                "2x": "2800k",
                "2x_hq": "4200k",
                "4x": "5000k",
                "4x_hq": "7000k",
                "video_hq": "8500k",
                "anime": "3600k",
                "photo_detail": "4800k",
                "denoise": "2600k",
            },
        )
        self.upscaler_image_quality_targets: Dict[str, int] = self._load_json_map(
            os.getenv("UPSCALER_IMAGE_QUALITY_TARGETS"),
            {
                "2x": 90,
                "2x_hq": 95,
                "4x": 92,
                "4x_hq": 96,
                "video_hq": 92,
                "anime": 93,
                "photo_detail": 95,
                "denoise": 90,
            },
        )
        self.upscaler_denoise_strengths: Dict[str, float] = self._load_json_map(
            os.getenv("UPSCALER_DENOISE_STRENGTHS"),
            {
                "2x": 0.0,
                "2x_hq": 0.2,
                "4x": 0.1,
                "4x_hq": 0.25,
                "video_hq": 0.35,
                "anime": 0.15,
                "photo_detail": 0.3,
                "denoise": 0.75,
            },
        )
        self.upscaler_sharpen_strengths: Dict[str, float] = self._load_json_map(
            os.getenv("UPSCALER_SHARPEN_STRENGTHS"),
            {
                "2x": 0.8,
                "2x_hq": 1.0,
                "4x": 0.85,
                "4x_hq": 1.15,
                "video_hq": 1.2,
                "anime": 0.7,
                "photo_detail": 1.05,
                "denoise": 0.2,
            },
        )
        self.upscaler_max_output_dimensions: Dict[str, int] = self._load_json_map(
            os.getenv("UPSCALER_MAX_OUTPUT_DIMENSIONS"),
            {
                "2x": 3840,
                "2x_hq": 4096,
                "4x": 4096,
                "4x_hq": 6144,
                "video_hq": 4096,
                "anime": 4096,
                "photo_detail": 5120,
                "denoise": 4096,
            },
        )

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

    @staticmethod
    def _load_json_map(raw: str | None, default: Dict[str, object]) -> Dict[str, object]:
        if not raw:
            return dict(default)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return dict(default)
        if not isinstance(parsed, dict):
            return dict(default)
        merged = dict(default)
        merged.update(parsed)
        return merged


settings = Settings()
