from __future__ import annotations

import pytest
from pydantic import ValidationError

from argus_cdn.config import Settings, load_settings

VALID_TOKEN = "cdn-token-0123456789abcdef0123456789abcdef"


def test_missing_required_settings_fail_fast(monkeypatch, tmp_path):
    for name in ("CDN_AUTH_TOKEN", "CDN_BASE_URL", "STORAGE_ROOT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)

    with pytest.raises(RuntimeError, match="CDN_AUTH_TOKEN"):
        load_settings()


def test_base_url_is_normalised():
    settings = Settings(
        _env_file=None,
        cdn_auth_token=VALID_TOKEN,
        cdn_base_url="https://cdn.example.com/",
        storage_root="./storage",
    )
    assert settings.cdn_base_url == "https://cdn.example.com"
    assert settings.temp_root.name == ".tmp"


def test_base_url_must_be_absolute():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            cdn_auth_token=VALID_TOKEN,
            cdn_base_url="not-a-url",
            storage_root="./storage",
        )


def test_default_limits_match_the_architecture():
    settings = Settings(
        _env_file=None,
        cdn_auth_token=VALID_TOKEN,
        cdn_base_url="https://cdn.example.com",
        storage_root="./storage",
    )
    assert settings.max_image_bytes == 50 * 1024 * 1024
    assert settings.max_audio_bytes == 200 * 1024 * 1024


@pytest.mark.parametrize(
    "token,reason",
    [
        ("short-token", "at least 32"),
        ("x" * 32, "high-entropy"),
        ("replace-with-at-least-32-random-characters", "placeholder"),
    ],
)
def test_weak_tokens_are_rejected_without_echoing_the_value(token, reason):
    with pytest.raises(ValidationError) as caught:
        Settings(
            _env_file=None,
            cdn_auth_token=token,
            cdn_base_url="https://cdn.example.com",
            storage_root="./storage",
        )

    message = str(caught.value)
    assert reason in message
    assert token not in message
