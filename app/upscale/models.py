from __future__ import annotations

from enum import Enum
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class JobState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class UpscaleRequest(BaseModel):
    path: str
    profile: Literal["2x", "4x", "denoise"] = "2x"
    overwrite: bool = False


class UpscaleJob(BaseModel):
    id: str
    state: JobState = JobState.QUEUED
    path: str
    profile: str
    overwrite: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    output_path: str | None = None
    output_url: str | None = None
    error: str | None = None


class UpscaleSubmitResponse(BaseModel):
    job_id: str
    state: JobState


class UpscaleStatusResponse(BaseModel):
    job: UpscaleJob
