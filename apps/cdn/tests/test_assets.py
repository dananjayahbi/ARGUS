from __future__ import annotations

from urllib.parse import urlparse


def _upload(client, auth_headers, png_bytes, filename="shot.png", category="raw"):
    response = client.post(
        "/api/upload",
        data={"category": category},
        files={"file": (filename, png_bytes, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 201
    return urlparse(response.json()["url"]).path


def test_stored_asset_is_served_with_type_length_and_cache_headers(client, auth_headers, png_bytes):
    path = _upload(client, auth_headers, png_bytes)

    response = client.get(path)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert int(response.headers["content-length"]) == len(png_bytes)
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["cross-origin-resource-policy"] == "cross-origin"
    assert response.content == png_bytes


def test_missing_asset_returns_404_without_a_stack_trace(client):
    response = client.get("/raw/2026/11/00000000-0000-0000-0000-000000000000_missing.png")

    assert response.status_code == 404
    assert response.json() == {"detail": "Asset not found."}
    assert "Traceback" not in response.text


def test_traversal_attempt_returns_404(client):
    response = client.get("/raw/2026/11/..%2F..%2Fetc%2Fpasswd")

    assert response.status_code == 404
    assert "root:" not in response.text


def test_unknown_category_returns_404(client):
    response = client.get("/etc/2026/11/abc_shot.png")

    assert response.status_code == 404


def test_invalid_month_returns_404(client):
    response = client.get("/raw/2026/13/abc_shot.png")

    assert response.status_code == 404
