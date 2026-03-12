from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

UPSCALE_PROFILE_ALIASES: dict[str, str] = {
    "2x": "2x",
    "4x": "4x",
    "denoise": "denoise",
    "2x_hq": "2x_hq",
    "4x_hq": "4x_hq",
    "video_hq": "video_hq",
    "anime": "anime",
    "photo_detail": "photo_detail",
}

UPSCALE_PROFILE_LABELS: dict[str, str] = {
    "2x": "2x (fast)",
    "2x_hq": "2x HQ (balanced)",
    "4x": "4x (slow)",
    "4x_hq": "4x HQ (slowest)",
    "video_hq": "Video HQ",
    "denoise": "Denoise",
    "anime": "Anime",
    "photo_detail": "Photo detail",
}


class JobState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class UpscaleRequest(BaseModel):
    path: str
    profile: str = "2x"
    overwrite: bool = False

    @field_validator("profile")
    @classmethod
    def validate_profile(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in UPSCALE_PROFILE_ALIASES:
            supported = ", ".join(sorted(UPSCALE_PROFILE_ALIASES))
            raise ValueError(f"Unsupported profile '{value}'. Supported profiles: {supported}")
        return UPSCALE_PROFILE_ALIASES[normalized]


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


class UpscaleProfileOption(BaseModel):
    key: str
    label: str


class UpscaleProfilesResponse(BaseModel):
    profiles: list[UpscaleProfileOption]
