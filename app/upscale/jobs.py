from __future__ import annotations

import mimetypes
import queue
import secrets
import threading
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

from ..config import settings
from .engine import UpscaleEngine, build_output_path
from .models import JobState, UpscaleJob, UpscaleRequest


class UpscaleJobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, UpscaleJob] = {}
        self._lock = threading.Lock()
        self._queue: queue.Queue[str] = queue.Queue()
        self._cancelled: set[str] = set()
        self._engine = UpscaleEngine(
            backend=settings.upscaler_backend,
            model_path=settings.upscaler_model_path,
            use_gpu=settings.upscaler_use_gpu,
        )

        self._workers: list[threading.Thread] = []
        if settings.enable_ai_upscaler:
            for index in range(max(1, settings.upscaler_worker_concurrency)):
                worker = threading.Thread(target=self._worker_loop, name=f"upscale-worker-{index}", daemon=True)
                worker.start()
                self._workers.append(worker)

    def submit(self, request: UpscaleRequest) -> UpscaleJob:
        if not settings.enable_ai_upscaler:
            raise HTTPException(status_code=503, detail="AI upscaler is disabled")

        source_path = self._validate_source_path(request.path)
        self._validate_caps(source_path)

        job = UpscaleJob(
            id=secrets.token_hex(8),
            path=request.path,
            profile=request.profile,
            overwrite=request.overwrite,
        )

        with self._lock:
            self._jobs[job.id] = job
        self._queue.put(job.id)
        return job

    def get(self, job_id: str) -> UpscaleJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_recent(self, limit: int = 30) -> list[UpscaleJob]:
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(key=lambda job: job.updated_at, reverse=True)
        return jobs[:limit]

    def cancel(self, job_id: str) -> UpscaleJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError("Job not found")
            if job.state in {JobState.COMPLETED, JobState.FAILED}:
                return job
            self._cancelled.add(job_id)
            job.state = JobState.FAILED
            job.error = "Cancelled"
            job.updated_at = datetime.utcnow()
            job.finished_at = datetime.utcnow()
            return job

    def _worker_loop(self) -> None:
        while True:
            job_id = self._queue.get()
            try:
                self._run_job(job_id)
            finally:
                self._queue.task_done()

    def _run_job(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job_id in self._cancelled:
                return
            job.state = JobState.RUNNING
            job.started_at = datetime.utcnow()
            job.updated_at = datetime.utcnow()

        source_path = settings.media_dir / Path(job.path)
        target_path = build_output_path(Path(job.path), job.profile, job.overwrite)

        try:
            if job_id in self._cancelled:
                raise RuntimeError("Cancelled")
            self._engine.run(source_path, target_path, job.profile)
            if job_id in self._cancelled:
                raise RuntimeError("Cancelled")

            relative_output = target_path.relative_to(settings.media_dir)
            with self._lock:
                latest = self._jobs.get(job_id)
                if latest is None:
                    return
                latest.state = JobState.COMPLETED
                latest.finished_at = datetime.utcnow()
                latest.updated_at = datetime.utcnow()
                latest.output_path = str(relative_output)
                latest.output_url = f"/media/{relative_output}"
                latest.error = None
        except Exception as error:
            target_path.unlink(missing_ok=True)
            with self._lock:
                latest = self._jobs.get(job_id)
                if latest is None:
                    return
                latest.state = JobState.FAILED
                latest.finished_at = datetime.utcnow()
                latest.updated_at = datetime.utcnow()
                latest.error = str(error)

    def _validate_source_path(self, raw_path: str) -> Path:
        if not raw_path:
            raise HTTPException(status_code=400, detail="Path is required")
        if raw_path.startswith("link:"):
            raise HTTPException(status_code=400, detail="Links cannot be upscaled")

        source_path = (settings.media_dir / raw_path).resolve()
        try:
            source_path.relative_to(settings.media_dir)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Path must be inside media directory") from error

        if not source_path.is_file():
            raise HTTPException(status_code=404, detail="Media not found")

        mime_type, _ = mimetypes.guess_type(source_path.name)
        mime_type = mime_type or "application/octet-stream"
        if not any(mime_type.startswith(prefix) for prefix in settings.upscaler_allowed_mime_prefixes):
            raise HTTPException(status_code=400, detail=f"Unsupported mime type: {mime_type}")

        return source_path

    def _validate_caps(self, source_path: Path) -> None:
        if settings.upscaler_max_input_bytes > 0 and source_path.stat().st_size > settings.upscaler_max_input_bytes:
            raise HTTPException(status_code=413, detail="File too large for upscaler")

        mime_type, _ = mimetypes.guess_type(source_path.name)
        if mime_type and mime_type.startswith("video") and settings.upscaler_max_video_seconds > 0:
            # Lightweight guardrail: estimate duration from bitrate if known; otherwise disallow very large files.
            # This avoids forcing ffprobe as a hard dependency.
            approx_max_video_bytes = settings.upscaler_max_video_seconds * settings.upscaler_video_bytes_per_second
            if source_path.stat().st_size > approx_max_video_bytes:
                raise HTTPException(status_code=413, detail="Video appears too long for configured cap")


job_manager = UpscaleJobManager()
