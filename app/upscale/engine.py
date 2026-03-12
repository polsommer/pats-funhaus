from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from ..config import settings

IMAGE_PROFILE_PIPELINES: dict[str, dict[str, object]] = {
    "2x": {"scale": 2, "denoise": False, "style": "photo"},
    "2x_hq": {"scale": 2, "denoise": True, "style": "photo"},
    "4x": {"scale": 4, "denoise": False, "style": "photo"},
    "4x_hq": {"scale": 4, "denoise": True, "style": "photo"},
    "video_hq": {"scale": 1, "denoise": True, "style": "photo"},
    "anime": {"scale": 2, "denoise": False, "style": "anime"},
    "photo_detail": {"scale": 2, "denoise": True, "style": "photo"},
    "denoise": {"scale": 1, "denoise": True, "style": "photo"},
}

VIDEO_PROFILE_PIPELINES: dict[str, dict[str, object]] = {
    "2x": {"scale": 2, "base_denoise": False},
    "2x_hq": {"scale": 2, "base_denoise": True},
    "4x": {"scale": 4, "base_denoise": False},
    "4x_hq": {"scale": 4, "base_denoise": True},
    "video_hq": {"scale": 2, "base_denoise": True},
    "anime": {"scale": 2, "base_denoise": False},
    "photo_detail": {"scale": 2, "base_denoise": True},
    "denoise": {"scale": 1, "base_denoise": True},
}


class UpscaleEngine:
    """Best-effort upscaler backend adapter with profile-aware pipelines."""

    def __init__(self, backend: str, model_path: str | None = None, use_gpu: bool = False) -> None:
        self.backend = backend.lower().strip()
        self.model_path = model_path
        self.use_gpu = use_gpu

    def run(self, source: Path, target: Path, profile: str) -> None:
        mime = _guess_mime(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        normalized_profile = profile.strip().lower()

        if mime.startswith("video/"):
            self._run_video_ffmpeg(source, target, normalized_profile)
            return

        self._run_image(source, target, normalized_profile)

    def _run_image(self, source: Path, target: Path, profile: str) -> None:
        image_backend = settings.upscaler_image_backend.lower().strip()
        if image_backend == "pil":
            self._run_pillow(source, target, profile)
            return
        shutil.copy2(source, target)

    def _run_pillow(self, source: Path, target: Path, profile: str) -> None:
        mime = _guess_mime(source)
        if not mime.startswith("image/"):
            shutil.copy2(source, target)
            return

        try:
            from PIL import Image, ImageEnhance, ImageFilter
        except ImportError:
            shutil.copy2(source, target)
            return

        pipeline = IMAGE_PROFILE_PIPELINES.get(profile, IMAGE_PROFILE_PIPELINES["2x"])
        scale = int(pipeline.get("scale", 1))
        denoise_strength = float(settings.upscaler_denoise_strengths.get(profile, 0.0))
        sharpen_strength = float(settings.upscaler_sharpen_strengths.get(profile, 0.0))
        max_dimension = int(settings.upscaler_max_output_dimensions.get(profile, 4096))
        image_quality = int(settings.upscaler_image_quality_targets.get(profile, 92))

        with Image.open(source) as img:
            processed = img
            if bool(pipeline.get("denoise")) or denoise_strength > 0:
                denoise_passes = max(1, round(denoise_strength * 2))
                for _ in range(denoise_passes):
                    processed = processed.filter(ImageFilter.MedianFilter(size=3))

            if scale > 1:
                scaled_w = processed.width * scale
                scaled_h = processed.height * scale
                cap_ratio = min(1.0, max_dimension / max(scaled_w, scaled_h)) if max(scaled_w, scaled_h) else 1.0
                new_size = (max(1, int(scaled_w * cap_ratio)), max(1, int(scaled_h * cap_ratio)))
                processed = processed.resize(new_size, Image.Resampling.LANCZOS)

            if pipeline.get("style") == "anime":
                processed = processed.filter(ImageFilter.SMOOTH_MORE)

            if sharpen_strength > 0:
                processed = ImageEnhance.Sharpness(processed).enhance(1.0 + sharpen_strength)

            save_kwargs: dict[str, int] = {}
            if target.suffix.lower() in {".jpg", ".jpeg", ".webp"}:
                save_kwargs["quality"] = max(30, min(100, image_quality))
            processed.save(target, **save_kwargs)

    def _run_video_ffmpeg(self, source: Path, target: Path, profile: str) -> None:
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            raise RuntimeError("ffmpeg is not installed or not available in PATH; cannot process video upscaling")

        # CPU-first default for reliability on Raspberry Pi and low-power systems.
        gpu_requested = self.use_gpu and not settings.upscaler_force_cpu
        video_backend = settings.upscaler_video_backend.lower().strip()
        video_codec = "libx264"
        hwaccel_args: list[str] = []
        filter_chain = self._build_video_filter_chain(profile)

        if gpu_requested and video_backend in {"ffmpeg_cuda", "cuda", "nvidia", "nvenc"}:
            hwaccel_args = ["-hwaccel", "cuda"]
            video_codec = "h264_nvenc"

        target_bitrate = str(settings.upscaler_video_bitrate_targets.get(profile, "3000k"))

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
            "medium" if "hq" in profile or profile == "photo_detail" else "faster",
            "-b:v",
            target_bitrate,
            "-maxrate",
            target_bitrate,
            "-bufsize",
            str(int(target_bitrate.rstrip("k")) * 2) + "k" if target_bitrate.endswith("k") else target_bitrate,
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

    def _build_video_filter_chain(self, profile: str) -> list[str]:
        pipeline = VIDEO_PROFILE_PIPELINES.get(profile, VIDEO_PROFILE_PIPELINES["2x"])
        scale = int(pipeline.get("scale", 1))
        denoise_strength = float(settings.upscaler_denoise_strengths.get(profile, 0.0))
        sharpen_strength = float(settings.upscaler_sharpen_strengths.get(profile, 0.0))
        max_dimension = int(settings.upscaler_max_output_dimensions.get(profile, 4096))

        filter_chain: list[str] = []
        if bool(pipeline.get("base_denoise")) or denoise_strength > 0:
            hqdn_luma = max(0.0, denoise_strength * 2.0)
            hqdn_chroma = max(0.0, denoise_strength * 1.6)
            filter_chain.append(f"hqdn3d={hqdn_luma:.2f}:{hqdn_chroma:.2f}:6:6")

        if scale > 1:
            filter_chain.append(
                "scale='trunc(min(iw*{scale},{cap})/2)*2:trunc(min(ih*{scale},{cap})/2)*2':flags=lanczos".format(
                    scale=scale,
                    cap=max_dimension,
                )
            )
        else:
            filter_chain.append("scale='trunc(min(iw,{cap})/2)*2:trunc(min(ih,{cap})/2)*2'".format(cap=max_dimension))

        if profile == "anime":
            filter_chain.append("eq=saturation=1.08:contrast=1.04")

        if sharpen_strength > 0:
            filter_chain.append(f"unsharp=5:5:{sharpen_strength:.2f}:3:3:0.20")

        return filter_chain


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
