"""Environment-driven configuration for the ARGUS CDN daemon."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from the environment (and an optional .env file)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        hide_input_in_errors=True,
    )

    cdn_auth_token: str = Field(..., min_length=1)
    cdn_base_url: str = Field(..., min_length=1)
    storage_root: Path = Field(...)

    max_image_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    max_audio_bytes: int = Field(default=200 * 1024 * 1024, gt=0)

    host: str = "127.0.0.1"
    port: int = Field(default=8080, ge=1, le=65535)
    log_level: str = "INFO"

    sentry_dsn: str | None = None
    sentry_environment: str | None = None
    sentry_release: str = "argus-cdn@0.1.0"
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)

    @field_validator("cdn_auth_token")
    @classmethod
    def _validate_auth_token(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 32:
            raise ValueError("CDN_AUTH_TOKEN must be at least 32 characters")
        placeholders = (
            "replace-with",
            "changeme",
            "change-me",
            "your-token",
            "example-token",
        )
        if any(marker in value.lower() for marker in placeholders):
            raise ValueError(
                "CDN_AUTH_TOKEN must not be a documented placeholder value"
            )
        if len(set(value)) < 8:
            raise ValueError(
                "CDN_AUTH_TOKEN must be a high-entropy secret, not a repeated pattern"
            )
        return value

    @field_validator("cdn_base_url")
    @classmethod
    def _normalise_base_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                "CDN_BASE_URL must be an absolute http(s) URL, for example https://cdn.example.com"
            )
        return value

    @field_validator("storage_root", mode="before")
    @classmethod
    def _expand_storage_root(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("STORAGE_ROOT must not be empty")
            return Path(value).expanduser()
        return value

    @property
    def temp_root(self) -> Path:
        """Directory used for in-progress uploads on the same volume as final storage."""
        return self.storage_root / ".tmp"


def load_settings() -> Settings:
    """Load settings, converting validation failures into a readable startup error."""
    try:
        return Settings()
    except ValidationError as exc:
        missing = sorted(
            str(error["loc"][0]).upper() for error in exc.errors() if error.get("type") == "missing"
        )
        detail = f" Missing required variables: {', '.join(missing)}." if missing else ""
        raise RuntimeError(
            "Invalid ARGUS CDN configuration. Required environment variables are "
            f"CDN_AUTH_TOKEN, CDN_BASE_URL and STORAGE_ROOT.{detail} Details: {exc}"
        ) from exc
