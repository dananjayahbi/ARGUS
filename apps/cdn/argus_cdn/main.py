"""Application factory for the ARGUS CDN daemon."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .assets import router as assets_router
from .config import Settings, load_settings
from .health import router as health_router
from .observability import RequestContextMiddleware, init_sentry
from .storage import ensure_storage_layout
from .upload import router as upload_router


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the ASGI app, creating the storage tree before accepting traffic."""
    resolved = settings or load_settings()
    ensure_storage_layout(resolved.storage_root)
    init_sentry(resolved)

    app = FastAPI(
        title="ARGUS CDN",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = resolved

    # The Chrome extension side panel uploads directly with X-CDN-Auth-Token,
    # so the daemon must answer CORS preflights from the extension origin.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-CDN-Auth-Token"],
        max_age=86400,
    )

    # Added last so it is outermost: every response (including CORS
    # preflights) gets x-request-id, a JSON access log line and a Sentry tag.
    app.add_middleware(RequestContextMiddleware)

    # Registration order matters: concrete routes are declared before the
    # four-segment asset reader so they can never be shadowed.
    app.include_router(health_router)
    app.include_router(upload_router)
    app.include_router(assets_router)
    return app
