from __future__ import annotations

import re
from datetime import UTC, datetime
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from argus_cdn.main import create_app

URL_PATTERN = re.compile(
    r"^https://cdn\.test\.example/raw/\d{4}/\d{2}/"
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_shot\.png$"
)


def test_valid_png_upload_returns_201_and_stores_the_file(
    client, settings, auth_headers, png_bytes
):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["success"] is True
    assert body["file_size_bytes"] == len(png_bytes)
    assert URL_PATTERN.match(body["url"])

    stored = settings.storage_root / urlparse(body["url"]).path.lstrip("/")
    assert stored.is_file()
    assert stored.read_bytes() == png_bytes


def test_each_allowed_media_type_is_accepted(make_settings, auth_headers, png_bytes, media_headers):
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
    log_bytes = b"2026-11-07T10:00:00Z INFO server started\n"
    cases = [
        ("raw", "shot.png", png_bytes, "image/png"),
        ("annotated", "shot.webp", media_headers["webp"], "image/webp"),
        ("audio", "memo.webm", media_headers["webm"], "audio/webm"),
        ("audio", "memo.m4a", media_headers["mp4"], "audio/mp4"),
        ("audio", "memo.wav", media_headers["wav"], "audio/wav"),
        ("audio", "memo.ogg", media_headers["ogg"], "audio/ogg"),
        ("reconsider", "evidence.png", png_bytes, "image/png"),
        ("reconsider", "call.webm", media_headers["webm"], "audio/webm"),
        ("files", "report.pdf", pdf_bytes, "application/pdf"),
        ("files", "server.log", log_bytes, "text/plain"),
    ]

    settings = make_settings()
    with TestClient(create_app(settings)) as client:
        for category, filename, payload, content_type in cases:
            response = client.post(
                "/api/upload",
                data={"category": category},
                files={"file": (filename, payload, content_type)},
                headers=auth_headers,
            )
            assert response.status_code == 201, (category, content_type, response.text)


@pytest.mark.parametrize(
    ("filename", "payload", "content_type"),
    [
        ("payload.exe", b"MZ\x90\x00" + b"\x00" * 64, "application/x-msdownload"),
        ("page.html", b"<!doctype html><h1>x</h1>", "text/html"),
        ("script.js", b"alert(1)", "text/javascript"),
    ],
)
def test_disallowed_declared_types_are_rejected(
    client, settings, auth_headers, filename, payload, content_type
):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": (filename, payload, content_type)},
        headers=auth_headers,
    )

    assert response.status_code == 415
    assert list((settings.storage_root / "raw").rglob("*")) == []
    assert list(settings.temp_root.iterdir()) == []


def test_declared_type_must_match_sniffed_payload(client, settings, auth_headers):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("fake.png", b"<!doctype html><h1>not an image</h1>", "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 415
    assert "does not match" in response.json()["detail"]
    assert list((settings.storage_root / "raw").rglob("*")) == []
    assert list(settings.temp_root.iterdir()) == []


def test_oversized_image_returns_413_and_leaves_no_file(make_settings, auth_headers, png_bytes):
    settings = make_settings(max_image_bytes=512)
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/upload",
            data={"category": "raw"},
            files={"file": ("big.png", png_bytes + b"\x00" * 2048, "image/png")},
            headers=auth_headers,
        )

    assert response.status_code == 413
    assert list((settings.storage_root / "raw").rglob("*")) == []
    assert list(settings.temp_root.iterdir()) == []


def test_oversized_audio_returns_413_and_leaves_no_file(make_settings, auth_headers, media_headers):
    settings = make_settings(max_audio_bytes=512)
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/upload",
            data={"category": "audio"},
            files={"file": ("big.webm", media_headers["webm"] + b"\x00" * 2048, "audio/webm")},
            headers=auth_headers,
        )

    assert response.status_code == 413
    assert list((settings.storage_root / "audio").rglob("*")) == []
    assert list(settings.temp_root.iterdir()) == []


def test_empty_upload_is_rejected(client, settings, auth_headers):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("empty.png", b"", "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert list(settings.temp_root.iterdir()) == []


def test_unknown_category_is_rejected(client, settings, auth_headers, png_bytes):
    response = client.post(
        "/api/upload",
        data={"category": "temp"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert list(settings.temp_root.iterdir()) == []


def test_audio_category_rejects_images(client, auth_headers, png_bytes):
    response = client.post(
        "/api/upload",
        data={"category": "audio"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 415


@pytest.mark.parametrize("category", ["raw", "annotated"])
def test_image_categories_reject_audio(client, auth_headers, media_headers, category):
    response = client.post(
        "/api/upload",
        data={"category": category},
        files={"file": ("memo.webm", media_headers["webm"], "audio/webm")},
        headers=auth_headers,
    )

    assert response.status_code == 415


def test_reconsider_accepts_audio(client, auth_headers, media_headers):
    response = client.post(
        "/api/upload",
        data={"category": "reconsider"},
        files={"file": ("call.webm", media_headers["webm"], "audio/webm")},
        headers=auth_headers,
    )

    assert response.status_code == 201


def test_files_category_rejects_media(client, auth_headers, png_bytes, media_headers):
    image = client.post(
        "/api/upload",
        data={"category": "files"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    )
    audio = client.post(
        "/api/upload",
        data={"category": "files"},
        files={"file": ("memo.webm", media_headers["webm"], "audio/webm")},
        headers=auth_headers,
    )

    assert image.status_code == 415
    assert audio.status_code == 415


def test_files_category_rejects_mismatched_pdf(client, settings, auth_headers):
    response = client.post(
        "/api/upload",
        data={"category": "files"},
        files={"file": ("report.pdf", b"just text pretending to be a pdf", "application/pdf")},
        headers=auth_headers,
    )

    assert response.status_code == 415
    assert list((settings.storage_root / "files").rglob("*")) == []


def test_upload_preflight_allows_the_extension_origin(client):
    response = client.options(
        "/api/upload",
        headers={
            "Origin": "chrome-extension://argus",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-cdn-auth-token",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


def test_upload_lands_in_the_current_utc_shard(client, auth_headers, png_bytes):
    before = datetime.now(UTC)
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    )
    after = datetime.now(UTC)

    assert response.status_code == 201
    parts = urlparse(response.json()["url"]).path.strip("/").split("/")
    assert parts[0] == "raw"
    allowed = {(before.year, before.month), (after.year, after.month)}
    assert (int(parts[1]), int(parts[2])) in allowed


def test_two_uploads_with_the_same_filename_do_not_overwrite(
    client, settings, auth_headers, png_bytes
):
    first = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    ).json()
    second = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("shot.png", png_bytes, "image/png")},
        headers=auth_headers,
    ).json()

    assert first["url"] != second["url"]

    first_path = settings.storage_root / urlparse(first["url"]).path.lstrip("/")
    second_path = settings.storage_root / urlparse(second["url"]).path.lstrip("/")
    assert first_path.is_file()
    assert second_path.is_file()
    assert first_path != second_path
    assert first_path.read_bytes() == png_bytes
    assert second_path.read_bytes() == png_bytes


def test_traversal_filename_stays_inside_the_raw_category(
    client, settings, auth_headers, png_bytes
):
    response = client.post(
        "/api/upload",
        data={"category": "raw"},
        files={"file": ("../../etc/passwd.png", png_bytes, "image/png")},
        headers=auth_headers,
    )

    assert response.status_code == 201
    stored = settings.storage_root / urlparse(response.json()["url"]).path.lstrip("/")
    assert stored.is_file()
    assert stored.is_relative_to(settings.storage_root / "raw")
    assert stored.name.endswith("_passwd.png")
    assert ".." not in stored.parts
