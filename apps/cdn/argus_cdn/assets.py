"""Read-only asset delivery."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse

from .mime import MIME_BY_EXTENSION
from .storage import resolve_public_path

router = APIRouter()

# Stored names contain a UUID and never change, so immutable, year-long caching
# is safe for every read-only category (raw, annotated, audio, reconsider).
_CACHE_CONTROL = "public, max-age=31536000, immutable"


@router.get("/{category}/{year}/{month}/{filename}", tags=["assets"])
def read_asset(
    request: Request,
    category: str,
    year: str,
    month: str,
    filename: str,
) -> FileResponse:
    """Serve a stored asset, rejecting traversal and missing files with 404."""
    settings = request.app.state.settings

    try:
        path = resolve_public_path(settings.storage_root, category, year, month, filename)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found.",
        ) from None

    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found.",
        )

    suffix = Path(filename).suffix.lower()
    media_type = (
        MIME_BY_EXTENSION.get(suffix)
        or mimetypes.guess_type(filename)[0]
        or "application/octet-stream"
    )

    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": _CACHE_CONTROL,
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
        },
    )
