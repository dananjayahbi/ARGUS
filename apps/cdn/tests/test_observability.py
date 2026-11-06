from __future__ import annotations

import json
import logging
import re

from fastapi import FastAPI
from fastapi.testclient import TestClient

from argus_cdn.main import create_app
from argus_cdn.observability import (
    REQUEST_ID_HEADER,
    build_sentry_options,
    init_sentry,
    scrub_sentry_event,
)


def last_request_log(caplog) -> dict:
    for line in reversed(caplog.text.strip().splitlines()):
        if '"event":"request"' in line:
            return json.loads(line[line.index("{") :])
    raise AssertionError("no request log line found")


def test_request_id_is_propagated_and_logged_as_json(client, caplog):
    with caplog.at_level(logging.INFO, logger="argus_cdn.requests"):
        response = client.get("/healthz", headers={REQUEST_ID_HEADER: "req-123"})

    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER] == "req-123"

    record = last_request_log(caplog)
    assert record["event"] == "request"
    assert record["service"] == "cdn"
    assert record["request_id"] == "req-123"
    assert record["method"] == "GET"
    assert record["path"] == "/healthz"
    assert record["status"] == 200
    assert isinstance(record["duration_ms"], (int, float))


def test_request_id_is_generated_when_absent(client):
    response = client.get("/healthz")

    request_id = response.headers[REQUEST_ID_HEADER]
    assert re.fullmatch(r"[0-9a-f-]{36}", request_id)


def test_request_log_never_contains_query_strings_or_tokens(client, caplog):
    secret = "super-secret-token-value"
    with caplog.at_level(logging.INFO, logger="argus_cdn.requests"):
        client.get(f"/healthz?token={secret}")

    assert secret not in caplog.text
    assert last_request_log(caplog)["path"] == "/healthz"


def test_scrub_sentry_event_removes_request_secrets():
    event = {
        "request": {
            "method": "POST",
            "url": "https://cdn.example/api/upload?token=secret",
            "headers": {"Authorization": "Bearer secret"},
            "cookies": {"argus_session": "secret"},
            "data": {"note": "private"},
        },
        "user": {"email": "qa@example.com"},
        "breadcrumbs": [{"message": "token secret"}],
        "extra": {"note_body": "private", "safe": 1},
    }

    scrubbed = scrub_sentry_event(event)

    assert scrubbed is not None
    assert scrubbed["request"] == {
        "method": "POST",
        "url": "https://cdn.example/api/upload",
    }
    assert "user" not in scrubbed
    assert "breadcrumbs" not in scrubbed
    assert scrubbed["extra"] == {"note_body": "[REDACTED]", "safe": 1}


def test_sentry_is_disabled_without_a_dsn(settings):
    assert build_sentry_options(settings) is None
    assert init_sentry(settings) is False


def test_sentry_options_carry_release_environment_and_scrubbing(make_settings):
    configured = make_settings(
        sentry_dsn="https://public@example.com/1",
        sentry_environment="test",
        sentry_release="argus-cdn@test",
        sentry_traces_sample_rate=0.0,
    )

    options = build_sentry_options(configured)

    assert options is not None
    assert options["dsn"] == "https://public@example.com/1"
    assert options["environment"] == "test"
    assert options["release"] == "argus-cdn@test"
    assert options["send_default_pii"] is False

    scrubbed = options["before_send"](
        {
            "request": {"url": "https://cdn.example/x?token=abc"},
            "exception": {
                "values": [
                    {
                        "value": f"failed with {configured.cdn_auth_token}",
                    }
                ]
            },
        },
        None,
    )
    assert scrubbed is not None
    assert scrubbed["request"]["url"] == "https://cdn.example/x"
    assert configured.cdn_auth_token not in scrubbed["exception"]["values"][0]["value"]


def test_unhandled_exception_returns_500_with_request_id(make_settings):
    settings = make_settings()
    app: FastAPI = create_app(settings)

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("boom")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/boom", headers={REQUEST_ID_HEADER: "req-boom"})

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER] == "req-boom"
