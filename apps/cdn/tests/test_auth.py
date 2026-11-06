from __future__ import annotations

import logging

import pytest
from pydantic import ValidationError

EXPECTED_401 = {"detail": "Invalid or missing storage authorization credentials."}


def test_missing_token_returns_exact_401(client, png_bytes):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
    )

    assert response.status_code == 401
    assert response.json() == EXPECTED_401


def test_wrong_token_returns_401(client, png_bytes):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers={"X-CDN-Auth-Token": "definitely-not-the-token"},
    )

    assert response.status_code == 401
    assert response.json() == EXPECTED_401


def test_correct_token_reaches_the_handler(client, auth_headers, png_bytes):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["success"] is True


def test_healthz_stays_public(client):
    response = client.get("/healthz")
    assert response.status_code == 200


def test_short_token_is_rejected_without_echoing_the_value(make_settings):
    secret = "short-token"

    with pytest.raises(ValidationError) as caught:
        make_settings(cdn_auth_token=secret)

    assert "at least 32" in str(caught.value)
    assert secret not in str(caught.value)


def test_rejected_token_is_never_logged(client, caplog, png_bytes):
    attempted = "wrong-secret-value-that-must-not-be-logged"

    with caplog.at_level(logging.DEBUG):
        response = client.post(
            "/api/upload",
            data={"category": "raw"},
            files={"file": ("shot.png", png_bytes, "image/png")},
            headers={"X-CDN-Auth-Token": attempted},
        )

    assert response.status_code == 401
    assert attempted not in caplog.text
