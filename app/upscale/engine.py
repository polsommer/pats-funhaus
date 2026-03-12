from __future__ import annotations

import shutil
import subprocess
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
        mime = _guess_mime(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        if mime.startswith("video/"):
            self._run_video_ffmpeg(source, target, profile)
            return

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

    def _run_video_ffmpeg(self, source: Path, target: Path, profile: str) -> None:
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError("ffmpeg is not installed or not available in PATH; cannot process video upscaling")

        # CPU-first default for reliability on Raspberry Pi and low-power systems.
        gpu_requested = self.use_gpu and not settings.upscaler_force_cpu
        video_codec = "libx264"
        hwaccel_args: list[str] = []
        filter_chain: list[str] = []

        if profile == "2x":
            filter_chain.append("scale='trunc(iw*2/2)*2:trunc(ih*2/2)*2':flags=lanczos")
        elif profile == "4x":
            max_dimension = 4096
            filter_chain.append(
                "scale='trunc(min(iw*4,{cap})/2)*2:trunc(min(ih*4,{cap})/2)*2':flags=lanczos".format(
                    cap=max_dimension
                )
            )
        elif profile == "denoise":
            filter_chain.extend(["hqdn3d=1.5:1.5:6:6", "nlmeans=s=2:p=7:r=9"])

        # Optional sharpen pass for perceived detail after scaling.
        if profile in {"2x", "4x"}:
            filter_chain.append("unsharp=5:5:0.8:3:3:0.2")

        # Keep output in codec-friendly dimensions even when no resize profile is selected.
        if profile == "denoise":
            filter_chain.append("scale='trunc(iw/2)*2:trunc(ih/2)*2'")

        if gpu_requested:
            backend = self.backend.lower()
            if backend in {"ffmpeg_cuda", "cuda", "nvidia", "nvenc"}:
                hwaccel_args = ["-hwaccel", "cuda"]
                video_codec = "h264_nvenc"

        command = [
            ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *hwaccel_args,
            "-i",
            str(source),
            "-vf",
            ",".join(filter_chain) if filter_chain else "null",
            "-c:v",
            video_codec,
            "-preset",
            "medium",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            "-f",
            "mp4",
            str(target),
        ]

        command_target = target
        if source.resolve() == target.resolve():
            command_target = target.with_suffix(".tmp_upscale.mp4")
            command[-1] = str(command_target)

        try:
            subprocess.run(command, check=True, capture_output=True, text=True)
            if command_target != target:
                command_target.replace(target)
        except subprocess.CalledProcessError as error:
            stderr = error.stderr.strip() if error.stderr else "unknown ffmpeg error"
            raise RuntimeError(f"ffmpeg video processing failed for profile '{profile}': {stderr}") from error


def build_output_path(relative_path: Path, profile: str, overwrite: bool) -> Path:
    source_path = settings.media_dir / relative_path
    if overwrite:
        return source_path

    suffix = source_path.suffix
    if _guess_mime(source_path).startswith("video/"):
        suffix = ".mp4"
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
