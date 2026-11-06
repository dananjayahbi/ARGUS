from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from argus_cdn.storage import (
    CATEGORIES,
    build_public_url,
    build_relative_path,
    resolve_public_path,
    sanitize_filename,
)


def test_relative_path_uses_utc_year_and_month():
    path = build_relative_path(
        "raw",
        "shot.png",
        "image/png",
        now=datetime(2026, 1, 2, 3, 4, tzinfo=UTC),
    )

    assert path.parts[:3] == ("raw", "2026", "01")
    prefix, _, name = path.parts[3].partition("_")
    assert uuid.UUID(prefix)
    assert name == "shot.png"


def test_naive_datetime_is_treated_as_utc():
    path = build_relative_path(
        "audio", "memo.webm", "audio/webm", now=datetime(2026, 12, 31, 23, 59)
    )

    assert path.parts[:3] == ("audio", "2026", "12")


def test_same_filename_produces_distinct_paths():
    first = build_relative_path("raw", "shot.png", "image/png")
    second = build_relative_path("raw", "shot.png", "image/png")

    assert first != second
    assert first.name.split("_", 1)[0] != second.name.split("_", 1)[0]


def test_traversal_filename_cannot_escape_the_category():
    path = build_relative_path("raw", "../../etc/passwd.png", "image/png")

    assert path.parts[0] == "raw"
    assert ".." not in path.parts
    assert path.name.endswith("_passwd.png")


def test_windows_style_path_is_reduced_to_a_basename():
    path = build_relative_path("raw", r"C:\fakepath\shot.png", "image/png")

    assert path.name.endswith("_shot.png")
    assert "fakepath" not in path.name


def test_extension_is_replaced_when_it_contradicts_the_sniffed_type():
    assert sanitize_filename("photo.PNG", "image/jpeg") == "photo.jpg"
    assert sanitize_filename("clip.mov", "audio/mp4") == "clip.m4a"
    assert sanitize_filename("no-extension", "image/png") == "no-extension.png"


def test_consecutive_dots_are_collapsed():
    name = sanitize_filename("weird..name.png", "image/png")
    assert ".." not in name


def test_public_url_has_exactly_one_slash_at_each_join():
    relative = Path("raw", "2026", "11", "abc_shot.png")

    assert (
        build_public_url("https://cdn.example.com/", relative)
        == "https://cdn.example.com/raw/2026/11/abc_shot.png"
    )
    assert (
        build_public_url("https://cdn.example.com", relative)
        == "https://cdn.example.com/raw/2026/11/abc_shot.png"
    )


@pytest.mark.parametrize("category", CATEGORIES)
def test_url_joining_works_for_every_category(category):
    relative = Path(category, "2026", "11", "abc_shot.png")

    assert (
        build_public_url("https://cdn.example.com/", relative)
        == f"https://cdn.example.com/{category}/2026/11/abc_shot.png"
    )


@pytest.mark.parametrize(
    ("category", "year", "month", "filename"),
    [
        ("..", "2026", "11", "x.png"),
        ("raw", "26", "11", "x.png"),
        ("raw", "2026", "13", "x.png"),
        ("raw", "2026", "11", ".."),
        ("raw", "2026", "11", "../x.png"),
        ("raw", "2026", "11", "nested/x.png"),
    ],
)
def test_resolve_public_path_rejects_invalid_components(tmp_path, category, year, month, filename):
    with pytest.raises(ValueError):
        resolve_public_path(tmp_path, category, year, month, filename)


def test_resolve_public_path_returns_a_file_inside_the_root(tmp_path):
    target = tmp_path / "raw" / "2026" / "11" / "abc_shot.png"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"x")

    assert resolve_public_path(tmp_path, "raw", "2026", "11", "abc_shot.png") == target
