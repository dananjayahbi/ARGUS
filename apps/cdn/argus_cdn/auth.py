"""Shared-secret authentication for CDN write endpoints."""

from __future__ import annotations

import hmac

from fastapi import HTTPException, Request

_INVALID_CREDENTIALS = "Invalid or missing storage authorization credentials."


def require_cdn_token(request: Request) -> None:
    """Reject requests whose X-CDN-Auth-Token does not match the configured secret."""
    expected: str = request.app.state.settings.cdn_auth_token
    provided = request.headers.get("x-cdn-auth-token")
    if provided is None or not hmac.compare_digest(
        provided.encode("utf-8"), expected.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail=_INVALID_CREDENTIALS)
