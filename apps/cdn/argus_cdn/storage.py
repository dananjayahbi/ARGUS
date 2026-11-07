"""Filesystem layout, safe filenames and public URL construction."""

from __future__ import annotations

import os
import re
import unicodedata
import uuid
from datetime import UTC, datetime
from pathlib import Path

from .mime import ALLOWED_EXTENSIONS_BY_MIME, EXTENSION_BY_MIME

CATEGORIES: tuple[str, ...] = ("raw", "annotated", "audio", "reconsider", "files")

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")
_SAFE_EXTENSION = re.compile(r"^\.[a-z0-9]{1,10}$")
_SAFE_ASSET_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_YEAR = re.compile(r"^\d{4}$")
_MONTH = re.compile(r"^\d{2}$")


def ensure_storage_layout(storage_root: Path) -> None:
    """Idempotently create the four category roots and the upload temp directory."""
    for category in CATEGORIES:
        (storage_root / category).mkdir(parents=True, exist_ok=True)
    (storage_root / ".tmp").mkdir(parents=True, exist_ok=True)


def sanitize_filename(filename: str, mime_type: str) -> str:
    """Return a safe basename with the extension matching the sniffed MIME type.

    Path separators and traversal segments are removed rather than rejected so
    callers can pass browser-supplied names such as ``C:\\fakepath\\shot.png``.
    The generated file always sits directly inside a date-sharded directory.
    """
    raw = (filename or "").replace("\\", "/").split("/")[-1].strip()
    if raw in {"", ".", ".."}:
        raw = "file"

    stem, suffix = os.path.splitext(raw)
    suffix = suffix.lower()
    allowed_extensions = ALLOWED_EXTENSIONS_BY_MIME.get(mime_type, frozenset())
    if not _SAFE_EXTENSION.match(suffix) or suffix not in allowed_extensions:
        suffix = EXTENSION_BY_MIME[mime_type]

    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    stem = _UNSAFE_FILENAME_CHARS.sub("_", stem)
    stem = re.sub(r"\.{2,}", ".", stem)
    stem = re.sub(r"_+", "_", stem).strip("._-")
    stem = stem[:80].strip("._-") or "file"
    return f"{stem}{suffix}"


def build_relative_path(
    category: str,
    filename: str,
    mime_type: str,
    *,
    now: datetime | None = None,
) -> Path:
    """Build ``{category}/{YYYY}/{MM}/{uuid}_{filename}`` using UTC."""
    if category not in CATEGORIES:
        raise ValueError(f"Unsupported category: {category!r}")
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    else:
        moment = moment.astimezone(UTC)

    safe_name = sanitize_filename(filename, mime_type)
    return (
        Path(category)
        / f"{moment.year:04d}"
        / f"{moment.month:02d}"
        / f"{uuid.uuid4()}_{safe_name}"
    )


def build_public_url(base_url: str, relative_path: Path) -> str:
    """Join the configured origin and a relative asset path with exactly one slash."""
    path = "/".join(part for part in relative_path.parts if part not in {"", "."})
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def resolve_public_path(
    storage_root: Path,
    category: str,
    year: str,
    month: str,
    filename: str,
) -> Path:
    """Resolve a read request to a file inside the storage root or raise ValueError."""
    if category not in CATEGORIES:
        raise ValueError("Unknown asset category")
    if not _YEAR.match(year) or not _MONTH.match(month):
        raise ValueError("Invalid date shard")
    if not 1 <= int(month) <= 12:
        raise ValueError("Invalid month")
    if not _SAFE_ASSET_COMPONENT.match(filename) or ".." in filename:
        raise ValueError("Invalid asset name")

    root = storage_root.resolve()
    candidate = (root / category / year / month / filename).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError("Asset path escapes the storage root")
    return candidate
