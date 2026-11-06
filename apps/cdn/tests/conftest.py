from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from argus_cdn.config import Settings
from argus_cdn.main import create_app

CDN_TOKEN = "test-cdn-token-0123456789abcdef0123456789abcdef"

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
WEBM_HEAD = b"\x1a\x45\xdf\xa3" + b"\x00" * 128
MP4_HEAD = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 128
WAV_HEAD = b"RIFF" + b"\x00\x00\x00\x00" + b"WAVE" + b"\x00" * 128
OGG_HEAD = b"OggS" + b"\x00" * 128
WEBP_HEAD = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 128


@pytest.fixture
def make_settings(tmp_path):
    def _make(**overrides):
        values = {
            "_env_file": None,
            "cdn_auth_token": CDN_TOKEN,
            "cdn_base_url": "https://cdn.test.example",
            "storage_root": tmp_path / "storage",
            "max_image_bytes": 1024 * 1024,
            "max_audio_bytes": 2 * 1024 * 1024,
        }
        values.update(overrides)
        return Settings(**values)

    return _make


@pytest.fixture
def settings(make_settings):
    return make_settings()


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def auth_headers():
    return {"X-CDN-Auth-Token": CDN_TOKEN}


@pytest.fixture
def png_bytes():
    return PNG_1X1


@pytest.fixture
def media_headers():
    return {
        "webm": WEBM_HEAD,
        "mp4": MP4_HEAD,
        "wav": WAV_HEAD,
        "ogg": OGG_HEAD,
        "webp": WEBP_HEAD,
    }
