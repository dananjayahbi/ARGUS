"""Liveness endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Request

from . import __version__
from .storage import CATEGORIES

router = APIRouter()


@router.get("/healthz", tags=["system"])
def healthz(request: Request) -> dict[str, object]:
    """Report that the daemon is running and its storage layout is present."""
    settings = request.app.state.settings
    categories = {category: (settings.storage_root / category).is_dir() for category in CATEGORIES}
    return {
        "status": "ok",
        "service": "argus-cdn",
        "version": __version__,
        "categories": categories,
    }
