from __future__ import annotations

import shutil
from pathlib import Path

from ..config import settings


class UpscaleEngine:
    """Best-effort upscaler backend adapter.

    This implementation keeps dependencies optional:
    - "none": no upscaling, copies input to output.
    - "pil": attempts Pillow-based resize for images, fallback to copy.
    """

    def __init__(self, backend: str, model_path: str | None = None, use_gpu: bool = False) -> None:
        self.backend = backend.lower().strip()
        self.model_path = model_path
        self.use_gpu = use_gpu

    def run(self, source: Path, target: Path, profile: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        if self.backend == "pil":
            self._run_pillow(source, target, profile)
            return

        # Default behavior for disabled or unknown backends: copy source to target.
        shutil.copy2(source, target)

    def _run_pillow(self, source: Path, target: Path, profile: str) -> None:
        mime = _guess_mime(source)
        if not mime.startswith("image/"):
            shutil.copy2(source, target)
            return

        try:
            from PIL import Image, ImageFilter
        except ImportError:
            shutil.copy2(source, target)
            return

        scale = 1
        if profile == "2x":
            scale = 2
        elif profile == "4x":
            scale = 4

        with Image.open(source) as img:
            processed = img
            if profile == "denoise":
                processed = img.filter(ImageFilter.MedianFilter(size=3))

            if scale > 1:
                new_size = (max(1, processed.width * scale), max(1, processed.height * scale))
                processed = processed.resize(new_size, Image.Resampling.LANCZOS)

            processed.save(target)


def build_output_path(relative_path: Path, profile: str, overwrite: bool) -> Path:
    source_path = settings.media_dir / relative_path
    if overwrite:
        return source_path

    suffix = source_path.suffix
    stem = source_path.stem
    normalized_profile = profile.replace(" ", "_")
    upscaled_name = f"{stem}_upscaled_{normalized_profile}{suffix}"

    if settings.upscaler_output_mode == "sibling":
        return source_path.with_name(upscaled_name)

    # Default: dedicated output tree while preserving relative folder structure.
    return settings.upscaled_media_dir / relative_path.parent / upscaled_name


def _guess_mime(path: Path) -> str:
    import mimetypes

    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"
