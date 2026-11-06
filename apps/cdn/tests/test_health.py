from __future__ import annotations

from argus_cdn.storage import CATEGORIES, ensure_storage_layout


def test_healthz_returns_ok_and_reports_categories(client, settings):
    response = client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "argus-cdn"
    assert set(body["categories"]) == set(CATEGORIES)
    assert all(body["categories"].values())


def test_all_four_category_roots_are_created(client, settings):
    for category in CATEGORIES:
        assert (settings.storage_root / category).is_dir()


def test_storage_layout_is_idempotent(settings):
    ensure_storage_layout(settings.storage_root)
    ensure_storage_layout(settings.storage_root)

    for category in CATEGORIES:
        assert (settings.storage_root / category).is_dir()
