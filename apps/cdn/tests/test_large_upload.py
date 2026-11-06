"""Slow, end-to-end check that a 150 MB audio upload is streamed, not buffered."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from argus_cdn.main import create_app

from .conftest import CDN_TOKEN

pytestmark = pytest.mark.slow

MEGABYTE = 1024 * 1024
TARGET_BYTES = 150 * MEGABYTE


def _write_large_webm(path):
    header = b"\x1a\x45\xdf\xa3"
    chunk = b"\x00" * MEGABYTE
    written = 0
    with path.open("wb") as handle:
        handle.write(header)
        written += len(header)
        while written < TARGET_BYTES:
            remaining = TARGET_BYTES - written
            piece = chunk if remaining >= MEGABYTE else chunk[:remaining]
            handle.write(piece)
            written += len(piece)
    return written


def _write_sparse(path, header, total_bytes):
    """Create a file of the requested size without writing every zero byte."""
    with path.open("wb") as handle:
        handle.write(header)
        handle.seek(total_bytes - 1)
        handle.write(b"\x00")
    return total_bytes


@pytest.mark.slow
def test_image_above_the_default_50mb_limit_returns_413(make_settings, png_bytes):
    settings = make_settings(max_image_bytes=50 * MEGABYTE)
    payload_path = settings.storage_root.parent / "too-big.png"
    payload_path.parent.mkdir(parents=True, exist_ok=True)
    _write_sparse(payload_path, png_bytes, 50 * MEGABYTE + 1)

    with TestClient(create_app(settings)) as client, payload_path.open("rb") as handle:
        response = client.post(
            "/api/upload",
            data={"category": "raw"},
            files={"file": ("too-big.png", handle, "image/png")},
            headers={"X-CDN-Auth-Token": CDN_TOKEN},
        )

    assert response.status_code == 413
    assert list((settings.storage_root / "raw").rglob("*")) == []
    assert list(settings.temp_root.iterdir()) == []


@pytest.mark.slow
def test_audio_above_the_default_200mb_limit_returns_413(make_settings, media_headers):
    settings = make_settings(max_audio_bytes=200 * MEGABYTE)
    payload_path = settings.storage_root.parent / "too-big.webm"
    payload_path.parent.mkdir(parents=True, exist_ok=True)
    _write_sparse(payload_path, media_headers["webm"], 200 * MEGABYTE + 1)

    with TestClient(create_app(settings)) as client, payload_path.open("rb") as handle:
        response = client.post(
            "/api/upload",
            data={"category": "audio"},
            files={"file": ("too-big.webm", handle, "audio/webm")},
            headers={"X-CDN-Auth-Token": CDN_TOKEN},
        )

    assert response.status_code == 413
    assert list((settings.storage_root / "audio").rglob("*")) == []
    assert list(settings.temp_root.iterdir()) == []


def test_150mb_audio_upload_completes_and_stores_exact_size(make_settings):
    settings = make_settings(max_audio_bytes=200 * MEGABYTE)
    payload_path = settings.storage_root.parent / "large.webm"
    payload_path.parent.mkdir(parents=True, exist_ok=True)
    expected_size = _write_large_webm(payload_path)

    with TestClient(create_app(settings)) as client, payload_path.open("rb") as handle:
        response = client.post(
            "/api/upload",
            data={"category": "audio"},
            files={"file": ("memo.webm", handle, "audio/webm")},
            headers={"X-CDN-Auth-Token": CDN_TOKEN},
        )

    assert response.status_code == 201, response.text
    assert response.json()["file_size_bytes"] == expected_size
