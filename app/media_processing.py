from __future__ import annotations

import json
import logging
import mimetypes
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class MediaProcessor:
    """Generate and resolve lightweight media derivatives."""

    def __init__(
        self,
        media_dir: Path,
        derivatives_dir: Path,
        enable_video_derivatives: bool,
        max_derivative_width: int,
        target_video_bitrate: str,
    ) -> None:
        self.media_dir = media_dir
        self.derivatives_dir = derivatives_dir
        self.derivatives_dir.mkdir(parents=True, exist_ok=True)
        self.enable_video_derivatives = enable_video_derivatives
        self.max_derivative_width = max_derivative_width
        self.target_video_bitrate = target_video_bitrate

    def generate_for_relative_path(self, relative_path: Path) -> dict[str, Any]:
        source_path = (self.media_dir / relative_path).resolve()
        if not source_path.is_file():
            return {}

        try:
            source_path.relative_to(self.media_dir)
        except ValueError:
            return {}

        metadata: dict[str, Any] = {
            "path": str(relative_path),
            "thumbnail_url": None,
            "poster": None,
            "preview_url": None,
            "stream_url": None,
        }

        mime_type, _ = mimetypes.guess_type(source_path.name)
        mime_type = mime_type or "application/octet-stream"

        try:
            if mime_type.startswith("video"):
                self._generate_video_derivatives(source_path, relative_path, metadata)
            elif mime_type.startswith("image"):
                self._generate_image_derivatives(source_path, relative_path, metadata)
        except FileNotFoundError:
            logger.warning("ffmpeg is not installed; skipping media derivatives")
        except subprocess.CalledProcessError as error:
            logger.warning("Derivative generation failed for %s: %s", source_path, error)

        self._write_sidecar(relative_path, metadata)
        return metadata

    def load_metadata(self, relative_path: Path) -> dict[str, Any] | None:
        sidecar_path = self._sidecar_path(relative_path)
        if not sidecar_path.exists():
            return None
        try:
            with sidecar_path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, OSError):
            return None

    def delete_for_relative_path(self, relative_path: Path) -> None:
        stem = self._stem_path(relative_path)
        for candidate in (
            self.derivatives_dir / f"{stem}.thumb.jpg",
            self.derivatives_dir / f"{stem}.poster.jpg",
            self.derivatives_dir / f"{stem}.stream.mp4",
            self._sidecar_path(relative_path),
        ):
            candidate.unlink(missing_ok=True)

    def _generate_video_derivatives(
        self,
        source_path: Path,
        relative_path: Path,
        metadata: dict[str, Any],
    ) -> None:
        thumb_path = self.derivatives_dir / f"{self._stem_path(relative_path)}.thumb.jpg"
        poster_path = self.derivatives_dir / f"{self._stem_path(relative_path)}.poster.jpg"

        self._ensure_parent(thumb_path)
        self._ensure_parent(poster_path)

        self._run_ffmpeg(
            [
                "-y",
                "-ss",
                "00:00:01",
                "-i",
                str(source_path),
                "-frames:v",
                "1",
                "-vf",
                f"scale='min({self.max_derivative_width},iw)':-2",
                str(thumb_path),
            ]
        )
        self._run_ffmpeg(
            [
                "-y",
                "-ss",
                "00:00:01",
                "-i",
                str(source_path),
                "-frames:v",
                "1",
                "-vf",
                f"scale='min({self.max_derivative_width},iw)':-2",
                str(poster_path),
            ]
        )

        metadata["thumbnail_url"] = self._to_url(thumb_path)
        metadata["poster"] = self._to_url(poster_path)
        metadata["preview_url"] = metadata["thumbnail_url"]

        if self.enable_video_derivatives:
            stream_path = self.derivatives_dir / f"{self._stem_path(relative_path)}.stream.mp4"
            self._ensure_parent(stream_path)
            self._run_ffmpeg(
                [
                    "-y",
                    "-i",
                    str(source_path),
                    "-vf",
                    f"scale='min({self.max_derivative_width},iw)':-2",
                    "-c:v",
                    "libx264",
                    "-b:v",
                    self.target_video_bitrate,
                    "-movflags",
                    "+faststart",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    str(stream_path),
                ]
            )
            metadata["stream_url"] = self._to_url(stream_path)

    def _generate_image_derivatives(
        self,
        source_path: Path,
        relative_path: Path,
        metadata: dict[str, Any],
    ) -> None:
        thumb_path = self.derivatives_dir / f"{self._stem_path(relative_path)}.thumb.jpg"
        self._ensure_parent(thumb_path)

        self._run_ffmpeg(
            [
                "-y",
                "-i",
                str(source_path),
                "-frames:v",
                "1",
                "-vf",
                f"scale='min({self.max_derivative_width},iw)':-2",
                str(thumb_path),
            ]
        )

        metadata["thumbnail_url"] = self._to_url(thumb_path)
        metadata["poster"] = metadata["thumbnail_url"]
        metadata["preview_url"] = metadata["thumbnail_url"]

    def _run_ffmpeg(self, args: list[str]) -> None:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _stem_path(self, relative_path: Path) -> Path:
        relative = relative_path.with_suffix("")
        return Path(str(relative).replace("\\", "/"))

    def _sidecar_path(self, relative_path: Path) -> Path:
        return self.derivatives_dir / f"{self._stem_path(relative_path)}.json"

    @staticmethod
    def _ensure_parent(path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)

    def _write_sidecar(self, relative_path: Path, metadata: dict[str, Any]) -> None:
        sidecar_path = self._sidecar_path(relative_path)
        self._ensure_parent(sidecar_path)
        temp_path = sidecar_path.with_suffix(sidecar_path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2)
        temp_path.replace(sidecar_path)

    def _to_url(self, path: Path) -> str:
        relative = path.relative_to(self.derivatives_dir)
        return f"/derivatives/{relative.as_posix()}"
