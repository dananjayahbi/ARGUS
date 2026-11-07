# ARGUS CDN daemon

Headless asset storage service for the ARGUS QA ecosystem. It accepts
authenticated multipart uploads for five categories (`raw`, `annotated`,
`audio`, `reconsider`, `files`), validates MIME type and size, writes to UTC
year/month-sharded paths, and serves stored files read-only.

This is the local-first implementation of Phase 1 in
`system_architecture_plan.md` §7.

## Layout

```
apps/cdn/
├── argus_cdn/
│   ├── config.py     environment settings and fail-fast validation
│   ├── mime.py       allow-list and magic-byte sniffing
│   ├── storage.py    safe filenames, date sharding, URL construction
│   ├── auth.py       X-CDN-Auth-Token dependency
│   ├── health.py     GET /healthz
│   ├── upload.py     POST /api/upload
│   ├── assets.py     read-only GET /{category}/{YYYY}/{MM}/{file}
│   └── main.py       application factory
├── tests/
├── .env.example
└── pyproject.toml
```

## Requirements

- Python 3.11 or newer
- No external services or network access for the test suite

## Setup

From `apps/cdn`:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

Edit `.env` and set `CDN_AUTH_TOKEN` to a long random value. The checked-in
`.env` is a local development placeholder and is gitignored.

## Run

```powershell
python -m argus_cdn
```

or, with reload during development:

```powershell
uvicorn argus_cdn.main:create_app --factory --reload --host 127.0.0.1 --port 8080
```

The service binds to `HOST`/`PORT` from `.env` (default `127.0.0.1:8080`).
On boot it idempotently creates `STORAGE_ROOT/raw`, `STORAGE_ROOT/annotated`,
`STORAGE_ROOT/audio`, `STORAGE_ROOT/reconsider`, `STORAGE_ROOT/files` and
`STORAGE_ROOT/.tmp`.

Missing `CDN_AUTH_TOKEN`, `CDN_BASE_URL` or `STORAGE_ROOT` aborts startup with
a readable error naming the missing variables.

## Endpoints

### `GET /healthz`

Public. Returns:

```json
{
  "status": "ok",
  "service": "argus-cdn",
  "version": "0.1.0",
  "categories": { "raw": true, "annotated": true, "audio": true, "reconsider": true, "files": true }
}
```

### `POST /api/upload`

Requires `X-CDN-Auth-Token`. Multipart form fields:

| Field | Value |
| --- | --- |
| `file` | binary file stream |
| `category` | `raw`, `annotated`, `audio`, `reconsider` or `files` |

Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`, `audio/webm`,
`audio/mp4`, `audio/wav`, `audio/ogg`, `application/pdf`, `text/plain`.

Limits: 50 MB for image and document types, 200 MB for audio types. The body is
streamed to a temporary file on the storage volume and moved into place only
after the sniffed type matches the declared type.

Success (`201`):

```json
{
  "success": true,
  "url": "http://127.0.0.1:8080/raw/2026/11/<uuid>_shot.png",
  "file_size_bytes": 12345
}
```

Failures: `400` empty file or unknown category, `401` bad token with exactly
`{"detail": "Invalid or missing storage authorization credentials."}`, `413`
size limit, `415` disallowed or mismatched media type.

### `GET /{category}/{YYYY}/{MM}/{filename}`

Serves a stored asset with its canonical content type, content length, a
one-week cache header and `X-Content-Type-Options: nosniff`. Missing files,
invalid categories and traversal attempts return `404`.

## Category and MIME rules

- `raw` and `annotated` accept image types only.
- `audio` accepts audio types only.
- `files` accepts PDF or plain-text documents only.
- `reconsider` accepts image and audio types.
- Text-like documents (`.txt`, `.log`, `.md`, `.csv`, `.json`, `.xml`,
  `.yaml`, `.yml`) are stored as `text/plain` and served with
  `X-Content-Type-Options: nosniff`, so uploaded HTML or JavaScript cannot run
  in the browser.

## Tests

```powershell
pytest
```

The default run covers configuration, authentication, upload validation,
storage paths, URL construction and read-back. The 150 MB streaming check is
marked slow:

```powershell
pytest -m slow
```

To skip slow tests explicitly:

```powershell
pytest -m "not slow"
```

## Security notes

- The token is compared with `hmac.compare_digest` and is never logged.
- A startup warning is emitted when `CDN_AUTH_TOKEN` is shorter than 32
  characters.
- Filenames are reduced to a basename, stripped to an ASCII slug, and always
  prefixed with a UUID. Traversal components are removed before the file is
  written.
- The service does not transcode, thumbnail, scan for malware or verify image
  dimensions. Those are out of scope for this phase.
