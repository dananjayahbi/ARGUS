"""Structured request logging and Sentry error tracking for the CDN daemon."""

from __future__ import annotations

import json
import logging
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from starlette.datastructures import Headers, MutableHeaders

from .config import Settings

REQUEST_ID_HEADER = "x-request-id"
SERVICE_NAME = "cdn"

request_logger = logging.getLogger("argus_cdn.requests")


def configure_logging() -> None:
    """Emit request logs as one plain JSON line on stdout.

    Called by the CLI entrypoint only, so pytest's caplog still captures the
    records through normal propagation.
    """
    request_logger.setLevel(logging.INFO)
    if not request_logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        request_logger.addHandler(handler)
    request_logger.propagate = False

_SENSITIVE_KEY = re.compile(
    r"(token|secret|password|authorization|cookie|note|body|dsn|database_url|api[_-]?key)",
    re.IGNORECASE,
)


def _strip_query(url: str | None) -> str | None:
    if not url:
        return None
    return url.split("?", 1)[0]


def scrub_sentry_event(
    event: dict[str, Any],
    hint: Any = None,
    secrets: list[str] | None = None,
) -> dict[str, Any] | None:
    """Remove request bodies, headers, cookies, query strings and user data."""
    secrets = [secret for secret in (secrets or []) if len(secret) >= 8]

    def scrub_text(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        output = value
        for secret in secrets:
            output = output.replace(secret, "[REDACTED]")
        return output

    request = event.get("request")
    if isinstance(request, dict):
        event["request"] = {
            "method": request.get("method"),
            "url": _strip_query(request.get("url")),
        }

    event.pop("user", None)
    event.pop("breadcrumbs", None)

    if isinstance(event.get("message"), str):
        event["message"] = scrub_text(event["message"])

    exception = event.get("exception")
    if isinstance(exception, dict):
        values = exception.get("values")
        if isinstance(values, list):
            for value in values:
                if isinstance(value, dict) and "value" in value:
                    value["value"] = scrub_text(value["value"])

    extra = event.get("extra")
    if isinstance(extra, dict):
        event["extra"] = {
            key: "[REDACTED]" if _SENSITIVE_KEY.search(key) else value
            for key, value in extra.items()
        }

    return event


def build_sentry_options(settings: Settings) -> dict[str, Any] | None:
    """Return Sentry init options, or None when no DSN is configured."""
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn:
        return None

    return {
        "dsn": dsn,
        "environment": settings.sentry_environment or "development",
        "release": settings.sentry_release,
        "traces_sample_rate": settings.sentry_traces_sample_rate,
        "send_default_pii": False,
        "before_send": lambda event, hint: scrub_sentry_event(
            event, hint, secrets=[settings.cdn_auth_token]
        ),
        "integrations": [StarletteIntegration(), FastApiIntegration()],
    }


def init_sentry(
    settings: Settings,
    transport: Any = None,
) -> bool:
    """Initialise Sentry when a DSN is present. Local runs stay silent."""
    options = build_sentry_options(settings)
    if options is None:
        return False

    if transport is not None:
        options["transport"] = transport

    sentry_sdk.init(**options)
    return True


class RequestContextMiddleware:
    """Pure ASGI middleware: request id, JSON access log and Sentry tag."""

    def __init__(self, app: Callable) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        sentry_sdk.set_tag("request_id", request_id)
        sentry_sdk.set_tag("service", SERVICE_NAME)

        status = 500
        response_started = False
        started = time.perf_counter()

        async def send_with_request_id(message: dict[str, Any]) -> None:
            nonlocal status, response_started
            if message.get("type") == "http.response.start":
                status = int(message.get("status", 500))
                response_started = True
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as exc:  # noqa: BLE001 - boundary for error tracking
            with sentry_sdk.new_scope() as sentry_scope:
                sentry_scope.set_tag("request_id", request_id)
                sentry_scope.set_tag("service", SERVICE_NAME)
                sentry_sdk.capture_exception(exc)

            status = 500
            if not response_started:
                body = json.dumps(
                    {
                        "error": {
                            "code": "INTERNAL_ERROR",
                            "message": "Internal server error.",
                            "request_id": request_id,
                        }
                    },
                    separators=(",", ":"),
                ).encode("utf-8")
                await send(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii")),
                            (REQUEST_ID_HEADER.encode("ascii"), request_id.encode("ascii")),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
        finally:
            request_logger.info(
                json.dumps(
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "level": "info",
                        "service": SERVICE_NAME,
                        "event": "request",
                        "request_id": request_id,
                        "method": scope.get("method"),
                        "path": scope.get("path"),
                        "status": status,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
