"""Multipart asset upload endpoint."""

from __future__ import annotations

import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status

from .auth import require_cdn_token
from .mime import (
    ALLOWED_MIME_TYPES,
    AUDIO_MIME_TYPES,
    DOCUMENT_MIME_TYPES,
    IMAGE_MIME_TYPES,
    normalise_content_type,
    sniff_length,
    sniff_mime,
)
from .storage import CATEGORIES, build_public_url, build_relative_path

router = APIRouter()

_CHUNK_SIZE = 1024 * 1024
_ALLOWED_TYPE_LIST = ", ".join(sorted(ALLOWED_MIME_TYPES))


def _too_large(limit: int, label: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"Uploaded file exceeds the {label} limit of {limit // (1024 * 1024)} MB.",
    )


@router.post(
    "/api/upload",
    status_code=status.HTTP_201_CREATED,
    tags=["assets"],
)
async def upload_asset(
    request: Request,
    response: Response,
    category: Annotated[str, Form(...)],
    file: Annotated[UploadFile, File(...)],
    _: None = Depends(require_cdn_token),
) -> dict[str, object]:
    """Validate, stream and store one binary asset, returning its public URL."""
    settings = request.app.state.settings
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"

    if category not in CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported category. Expected one of: {', '.join(CATEGORIES)}.",
        )

    declared = normalise_content_type(file.content_type)
    if declared not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type. Allowed types: {_ALLOWED_TYPE_LIST}.",
        )

    if category == "audio" and declared not in AUDIO_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The audio category accepts audio uploads only.",
        )
    if category == "files" and declared not in DOCUMENT_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The files category accepts PDF or plain-text documents only.",
        )
    if category in {"raw", "annotated"} and declared not in IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"The {category} category accepts image uploads only.",
        )

    is_audio = declared in AUDIO_MIME_TYPES
    is_document = declared in DOCUMENT_MIME_TYPES
    limit = settings.max_audio_bytes if is_audio else settings.max_image_bytes
    limit_label = "audio" if is_audio else "file" if is_document else "image"

    first_chunk = await file.read(_CHUNK_SIZE)
    if not first_chunk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(first_chunk) > limit:
        raise _too_large(limit, limit_label)

    sniffed = sniff_mime(first_chunk[: sniff_length()])
    if sniffed is None or sniffed != declared:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Uploaded payload does not match the declared Content-Type.",
        )

    temp_path = settings.temp_root / f"upload-{uuid.uuid4().hex}.part"
    total_bytes = 0

    try:
        with temp_path.open("wb") as handle:
            chunk = first_chunk
            while chunk:
                total_bytes += len(chunk)
                if total_bytes > limit:
                    raise _too_large(limit, limit_label)
                handle.write(chunk)
                chunk = await file.read(_CHUNK_SIZE)

        relative_path = build_relative_path(category, file.filename or "file", sniffed)
        destination = settings.storage_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(temp_path, destination)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store the uploaded asset.",
        ) from exc
    finally:
        temp_path.unlink(missing_ok=True)
        await file.close()

    return {
        "success": True,
        "url": build_public_url(settings.cdn_base_url, relative_path),
        "file_size_bytes": total_bytes,
    }
