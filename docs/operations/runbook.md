# ARGUS operator runbook

- **Audience:** a new operator or agent deploying and running ARGUS
- **Scope:** Mini PC services, Cloudflare Tunnel, optional Vercel web hosting,
  database, extension, backups and troubleshooting
- **Related:** `system_architecture_plan.md`, `docs/security/secrets-and-authorization.md`,
  `docs/operations/observability.md`, `docs/operations/backup-restore.md`,
  `deploy/README.md`, `docs/operations/performance-report.md`

## 1. Architecture-to-repository map

| Component | Purpose | Path |
| --- | --- | --- |
| Python CDN daemon | Auth upload endpoint, immutable read-only asset serving, CORS, request IDs, Sentry | `apps/cdn/` |
| Next.js web app | Ingestion APIs, tokenized canvas editor, dashboard, auth, issue APIs, upload proxy | `apps/web/` |
| Chrome MV3 extension | Side panel capture, metadata/console harvesting, area/full-page snip, dispatch, text-only report | `apps/extension/` |
| Database migrations | Projects, issues, reconsider notes, supplementary assets, users/sessions, indexes | `apps/web/migrations/` |
| Web scripts | Migrate, seed, verify schema, integration/E2E/performance harnesses | `apps/web/scripts/` |
| CDN tests | Pytest suites for auth, upload validation, storage, assets, config, observability | `apps/cdn/tests/` |
| Tunnel/firewall | cloudflared config/unit, nftables/UFW policies, origin verification | `deploy/cloudflared/`, `deploy/firewall/` |
| Service units | systemd units for CDN, web, tunnel and backup timer | `deploy/systemd/`, `deploy/cloudflared/`, `deploy/backup/` |
| Backup/restore | Encrypted DB + asset backup, verify, retention, restore drill | `deploy/backup/` |
| Security docs | Secret inventory, trust boundaries, authorization matrix | `docs/security/` |
| Operations docs | Observability, backup, performance, this runbook | `docs/operations/` |
| ADRs | Canvas library and scene-graph decision | `docs/adr/` |
| CI | Lint, typecheck, unit/integration tests, build, secret scan, E2E, performance | `.github/workflows/ci.yml` |

The authoritative design is `system_architecture_plan.md` at the repository
root.

## 2. Prerequisites

### Mini PC (CDN + optional self-hosted web)

- Linux x86_64 with systemd (Ubuntu 22.04+ recommended).
- Node.js 24 and npm (web app).
- Python 3.11+ (3.12 recommended) and `python3-venv`.
- PostgreSQL 12+ reachable from the web service.
- `cloudflared` installed.
- A Cloudflare zone and a tunnel token.
- An off-box backup mount (NFS/SMB/SSHFS/rclone or separate USB disk).
- The repository checked out at `/opt/argus`.
- A dedicated `argus` OS user and `/etc/argus` directory (mode 700).

### Cloudflare

- Zone with `app` and `cdn` CNAMEs pointing at the tunnel (see
  `deploy/README.md`).
- Tunnel with public hostnames for `app` → `http://127.0.0.1:3000` and `cdn` →
  `http://127.0.0.1:8080`.
- Cache rules for immutable assets and API bypass.

### Vercel (optional web hosting)

- Vercel project rooted at `apps/web`.
- Build command `npm run build`, install command `npm ci`.
- The same web environment variables as the Mini PC, with a database URL
  reachable from Vercel and a public HTTPS `CDN_BASE_URL`.
- The CDN still runs on the Mini PC behind Cloudflare; Vercel never receives
  `CDN_AUTH_TOKEN` in client code (it is server-only).

## 3. Fresh local setup

```bash
git clone <repo> ARGUS
cd ARGUS

# Web
cd apps/web
npm ci
cp .env.example .env.local
# edit .env.local with real database/tokens
npm run db:migrate
npm run db:seed
npm run db:verify
npm run build
cd ../..

# CDN
cd apps/cdn
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env
# edit .env with CDN_AUTH_TOKEN, CDN_BASE_URL, STORAGE_ROOT
cd ../..

# Run locally
cd apps/cdn && python -m argus_cdn          # terminal 1
cd apps/web && npm run dev                  # terminal 2
```

The web app runs at `http://localhost:3000`, the CDN at
`http://127.0.0.1:8080`. Both `.env` files are gitignored.

## 4. Environment variables

### Web (`apps/web/.env.local`, production `/etc/argus/web.env`)

| Variable | Required | Secret | Purpose | Example |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | PostgreSQL connection string | `postgresql://argus:pass@127.0.0.1:5432/qa-db` |
| `WORKSPACE_TOKEN` | yes | yes | Extension → ingest API shared token (≥32 chars) | `workspace-token-…` |
| `DRAFT_TOKEN_SECRET` | yes | yes | HMAC key for 30-minute canvas draft tokens (≥32) | `draft-secret-…` |
| `CDN_AUTH_TOKEN` | yes | yes | Server-side CDN upload token used by `/api/uploads` (≥32) | `cdn-token-…` |
| `CDN_BASE_URL` | yes | no | Public HTTPS CDN origin, no trailing slash | `https://cdn.argus.example.com` |
| `SESSION_SECRET` | yes | yes | HS256 session JWT signing key (≥32) | `session-secret-…` |
| `QA_EMAIL` | yes | no | Initial QA account email | `qa@argus.local` |
| `QA_PASSWORD` | yes | yes | Initial QA password (≥8) | `qa-dev-password` |
| `DEVELOPER_EMAIL` | yes | no | Initial developer email | `dev@argus.local` |
| `DEVELOPER_PASSWORD` | yes | yes | Initial developer password (≥8) | `dev-dev-password` |
| `NODE_ENV` | no | no | `production` on servers, `development` locally | `production` |
| `SENTRY_DSN` | no | yes | Sentry DSN; empty disables Sentry | `https://…@sentry.io/…` |
| `SENTRY_ENVIRONMENT` | no | no | Sentry environment tag | `production` |
| `SENTRY_RELEASE` | no | no | Sentry release tag | `argus-web@0.1.0` |
| `SENTRY_TRACES_SAMPLE_RATE` | no | no | Trace sample rate, default `0` | `0` |
| `TEST_DATABASE_URL` | CI only | yes | Integration test database | `postgresql://…/argus_test` |

`QA_PASSWORD` / `DEVELOPER_PASSWORD` are seed-only: changing them does not
reset an existing hash.

### CDN (`apps/cdn/.env`, production `/etc/argus/cdn.env`)

| Variable | Required | Secret | Purpose | Example |
| --- | --- | --- | --- | --- |
| `CDN_AUTH_TOKEN` | yes | yes | Upload bearer token (≥32, high entropy) | `cdn-token-…` |
| `CDN_BASE_URL` | yes | no | Public origin used to build asset URLs | `https://cdn.argus.example.com` |
| `STORAGE_ROOT` | yes | no | Asset storage root | `/opt/argus/apps/cdn/storage` |
| `MAX_IMAGE_BYTES` | no | no | Image upload limit, default 50 MB | `52428800` |
| `MAX_AUDIO_BYTES` | no | no | Audio upload limit, default 200 MB | `209715200` |
| `HOST` | no | no | Bind address; keep loopback | `127.0.0.1` |
| `PORT` | no | no | Bind port | `8080` |
| `LOG_LEVEL` | no | no | Uvicorn log level | `INFO` |
| `SENTRY_DSN` | no | yes | Sentry DSN; empty disables Sentry | `https://…` |
| `SENTRY_ENVIRONMENT` | no | no | Sentry environment | `production` |
| `SENTRY_RELEASE` | no | no | Sentry release | `argus-cdn@0.1.0` |
| `SENTRY_TRACES_SAMPLE_RATE` | no | no | Trace sample rate | `0` |

### Extension settings (`chrome.storage.local`)

| Setting | Purpose | Example |
| --- | --- | --- |
| `appBaseUrl` | Web origin | `https://app.argus.example.com` |
| `cdnBaseUrl` | CDN origin | `https://cdn.argus.example.com` |
| `workspaceToken` | `WORKSPACE_TOKEN` value | `workspace-token-…` |
| `cdnToken` | `CDN_AUTH_TOKEN` value | `cdn-token-…` |
| `projectId` | Target project UUID | `11111111-1111-4111-8111-111111111111` |

### Backup (`/etc/argus/backup.env`)

| Variable | Required | Secret | Purpose | Example |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | Database to dump | `postgresql://…/qa-db` |
| `CDN_STORAGE_ROOT` | yes | no | Storage tree to archive | `/opt/argus/apps/cdn/storage` |
| `BACKUP_DIR` | yes | no | Off-box destination | `/mnt/offbox/argus-backups` |
| `BACKUP_ENCRYPTION_KEY` | yes | yes | AES-256-GCM key material (≥32) | `backup-key-…` |
| `BACKUP_RETENTION_DAYS` | no | no | Retention window, default 14 | `14` |
| `ALERT_WEBHOOK_URL` | no | yes | Slack-compatible failure webhook | `https://hooks.slack.com/…` |
| `RESTORE_DATABASE_URL` | restore only | yes | Scratch restore target | `postgresql://…/argus_restore_drill` |
| `RESTORE_STORAGE_DIR` | restore only | no | Scratch restore directory | `/tmp/argus-restore-drill` |

### Tunnel

| Variable | Required | Secret | Purpose | Example |
| --- | --- | --- | --- | --- |
| `TUNNEL_TOKEN` | yes | yes | Cloudflare tunnel token | `eyJhIjoi…` |

## 5. Database migrations and seed

Copy-paste from `apps/web`:

```bash
npm run db:migrate          # apply all migrations
npm run db:migrate:down     # roll back the last migration
npm run db:seed             # seed the ARGUS project (idempotent)
npm run db:verify           # assert tables, indexes and project exist
npm run test:integration    # integration suite against TEST_DATABASE_URL
```

Production:

```bash
cd /opt/argus/apps/web
sudo -u argus bash -c 'set -a; . /etc/argus/web.env; set +a; npm run db:migrate'
sudo -u argus bash -c 'set -a; . /etc/argus/web.env; set +a; npm run db:seed'
sudo -u argus bash -c 'set -a; . /etc/argus/web.env; set +a; npm run db:verify'
```

## 6. Production deployment

### 6.1 Mini PC services

```bash
sudo useradd --system --home /opt/argus --shell /usr/sbin/nologin argus
sudo install -d -m 700 /etc/argus
sudo chown -R argus:argus /opt/argus

# Environment files
sudo install -m 600 -o root -g root apps/web/.env.example /etc/argus/web.env
sudo install -m 600 -o root -g root apps/cdn/.env.example /etc/argus/cdn.env
sudoedit /etc/argus/web.env /etc/argus/cdn.env

# CDN
cd /opt/argus/apps/cdn
sudo -u argus python3 -m venv .venv
sudo -u argus .venv/bin/pip install -e .
sudo install -m 644 /opt/argus/deploy/systemd/argus-cdn.service /etc/systemd/system/

# Web
cd /opt/argus/apps/web
sudo -u argus npm ci
sudo -u argus bash -c 'set -a; . /etc/argus/web.env; set +a; npm run build'
sudo install -m 644 /opt/argus/deploy/systemd/argus-web.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now argus-cdn argus-web
sudo systemctl status argus-cdn argus-web
```

Both services bind `127.0.0.1`. Confirm:

```bash
ss -ltnp | grep -E ':8080|:3000'   # both must be 127.0.0.1
```

### 6.2 Cloudflare Tunnel and firewall

Follow `deploy/README.md` for DNS, tunnel and cache rules. Short version:

```bash
sudo install -m 600 -o root -g root \
  deploy/cloudflared/cloudflared.env.example /etc/argus/cloudflared.env
sudoedit /etc/argus/cloudflared.env        # TUNNEL_TOKEN
sudo install -m 644 deploy/cloudflared/argus-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now argus-tunnel
sudo nft -f deploy/firewall/argus-origin.nft   # or apply-ufw.sh
```

### 6.3 Vercel (optional)

1. Import the repository, root directory `apps/web`.
2. Framework preset Next.js, build `npm run build`, install `npm ci`.
3. Add every web environment variable from section 4. Set `CDN_BASE_URL` to
   the public CDN hostname and `NODE_ENV=production`.
4. Ensure the database accepts connections from Vercel (SSL/pooler) and run
   migrations once from a trusted host.
5. Set the Cloudflare `app` hostname to the Vercel deployment instead of the
   tunnel if the web app is hosted on Vercel; keep `cdn` on the tunnel.

### 6.4 Backups

```bash
sudo install -m 600 -o root -g root \
  deploy/backup/backup.env.example /etc/argus/backup.env
sudoedit /etc/argus/backup.env
sudo install -m 644 deploy/backup/argus-backup.service /etc/systemd/system/
sudo install -m 644 deploy/backup/argus-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now argus-backup.timer
sudo systemctl start argus-backup.service
sudo cat "$(grep BACKUP_DIR /etc/argus/backup.env | cut -d= -f2)/last-success.json"
```

Restore drill:

```bash
createdb -h 127.0.0.1 -U argus argus_restore_drill
cd /opt/argus/apps/web
sudo -u argus bash -c 'set -a; . /etc/argus/backup.env; set +a; node /opt/argus/deploy/backup/restore.mjs --database-url postgresql://argus:pass@127.0.0.1:5432/argus_restore_drill --storage-dir /tmp/argus-restore-drill'
psql postgresql://argus:pass@127.0.0.1:5432/argus_restore_drill -c "select count(*) from issues;"
```

Full policy and retention details: `docs/operations/backup-restore.md`.

## 7. Extension installation and token setup

```bash
cd apps/extension
npm run check
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, select `apps/extension/dist`.
2. Click the ARGUS toolbar icon to open the side panel.
3. Open **Settings** and enter:
   - App base URL: `https://app.argus.example.com` (or `http://localhost:3000`).
   - CDN base URL: `https://cdn.argus.example.com` (or `http://127.0.0.1:8080`).
   - Workspace ingestion token: `WORKSPACE_TOKEN` from the web env.
   - CDN upload token: `CDN_AUTH_TOKEN` from the CDN env.
   - Project ID: run
     `psql "$DATABASE_URL" -tAc "select id from projects where key='ARG'"`
     and paste the UUID.
4. Reload the extension after changing settings.
5. Verify: **Harvest now** shows metadata; **Area snip** produces a preview;
   **Use this screenshot** opens the canvas; **Text-only report** creates a
   pending issue without a canvas.

The extension stores tokens only in `chrome.storage.local` on that machine.

## 8. Verification and release gate

Run from the repository root unless noted:

```bash
# Web
cd apps/web
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:client-secrets
npm run test:integration

# CDN
cd ../cdn
.venv/bin/python -m pytest -m "not slow"

# E2E + performance (requires a build and DATABASE_URL)
cd ../web
npm run test:e2e
npm run test:e2e:reconsider
npm run test:perf

# Backup
cd ../..
npm run backup:test
```

CI runs the same commands. The Workflow A/B gates provision and drop their own
databases and temp storage.

## 9. Troubleshooting

### Login returns 401 / redirects back to `/login`

- Confirm the account exists and the password matches `QA_PASSWORD` or
  `DEVELOPER_PASSWORD`; the seed only inserts missing emails.
- Confirm `DATABASE_URL` points at the migrated database and `users` exists.
- A `Secure` cookie is used when `NODE_ENV=production`. Serve production over
  HTTPS (Cloudflare/Vercel). Browsers treat `localhost` as secure for local
  testing.
- Check the `argus_session` cookie is present and `SESSION_SECRET` has not
  changed since login.

### Upload returns 401

- `X-CDN-Auth-Token` must equal `CDN_AUTH_TOKEN` exactly (32+ chars).
- The web upload proxy uses the server-side token; the browser must not send
  `CDN_AUTH_TOKEN` itself.
- Dashboard attachment uploads need a valid `argus_session` cookie; canvas
  uploads need a valid draft token.

### Upload returns 413 / 415 / 422

- `413`: image > 50 MB or audio > 200 MB (`MAX_IMAGE_BYTES` /
  `MAX_AUDIO_BYTES`).
- `415`: MIME type not allowed. `raw`/`annotated` accept images; `audio`
  accepts WebM/MP4/WAV/OGG; `reconsider` accepts images and audio.
- `422`: unknown category or invalid payload. Allowed categories: `raw`,
  `annotated`, `reconsider`, `audio`.

### Canvas shows “Draft link expired” or “Invalid draft link”

- Draft tokens live for 30 minutes and are bound to one issue id.
- Re-run the capture from the extension to get a fresh token.
- `DRAFT_TOKEN_SECRET` must match the value used when the token was issued.
- Do not edit the `token` query parameter.

### Reconsider is refused

- The modal requires a non-empty note; the API returns 422 without one.
- Direct `PATCH /api/issues/[id]/status` to `reconsider` is rejected by design;
  use `POST /api/issues/[id]/reconsider`.
- The actor must have a valid dashboard session.

### Board is empty or 404

- The project key in the URL must exist (`select key from projects`).
- Log in again if the session expired.
- Confirm the issue belongs to that `project_id`; issue numbers are global but
  the board filters by project.

### Tunnel returns 502 / 1033

- `systemctl status argus-tunnel`; the token may be wrong or expired.
- Confirm the origin services are running and bound to `127.0.0.1:3000/8080`.
- Confirm the public hostname service in the dashboard points at the right
  local port.
- Check the origin firewall has not opened 3000/8080 publicly; the tunnel does
  not need inbound ports.

### CORS errors from the extension

- The CDN allows `*` for `GET/POST/OPTIONS` and the
  `Content-Type`/`X-CDN-Auth-Token` headers.
- The web proxy allows `*` and `Content-Type`/`X-Workspace-Token`/`Authorization`.
- A 405 on `OPTIONS /api/upload` means the preflight did not include
  `Origin`/`Access-Control-Request-Method`; retry from the extension.

### Sentry shows nothing

- `SENTRY_DSN` must be set in the service environment; empty disables it.
- Check outbound HTTPS from the Mini PC.
- Confirm `SENTRY_RELEASE`/`SENTRY_ENVIRONMENT` and that the project retention
  is 30 days.
- The request id is in the `x-request-id` response header and the JSON log
  line.

### Backup fails

- `/etc/argus/backup.env` is mode 600 and readable by the `argus` user.
- `BACKUP_DIR` is mounted and writable; a failed mount is the most common
  cause.
- `pg_dump`/`pg_restore` versions should be compatible with the server; the
  restore script tolerates the PG18→PG12 `transaction_timeout` skew.
- Check `last-failure.json` and the webhook alert; secrets are redacted.

### `check:client-secrets` fails

- A server secret value appeared in `.next/static` or `public/`.
- Move the value to a server component/route handler; never use
  `NEXT_PUBLIC_*` for tokens.

### Migrations fail

- Confirm `DATABASE_URL`, network access and that `pgcrypto` can be installed
  (migration 001 runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`).
- Run `npm run db:migrate` from `apps/web`; do not run migration files by hand.

## 10. Manual extension checklist

The E2E gates cover the service boundaries; the extension itself is verified
manually because real Chrome extension automation is out of scope.

- [ ] `npm run ext:check && npm run ext:build` pass.
- [ ] Load `apps/extension/dist` unpacked; no manifest errors.
- [ ] Settings persist after closing and reopening the side panel.
- [ ] Toolbar click opens the side panel.
- [ ] **Harvest now** shows URL, title, viewport, screen, DPR, OS and console
      entries.
- [ ] Area snip crops the selected rectangle at the correct pixel size.
- [ ] Full page stitches a tall page without duplicated fixed headers.
- [ ] **Use this screenshot** uploads to `raw`, creates a draft and opens the
      canvas.
- [ ] **Take another one** discards without network calls.
- [ ] Text-only report creates a pending issue with no image/canvas.
- [ ] Canvas: draw a pen annotation, submit, and see the issue on the board.
- [ ] Reconsider: developer note + attachment, then QA reply, both appear in
      the audit trail.

## 11. Related documentation

- `system_architecture_plan.md` — authoritative architecture.
- `docs/security/secrets-and-authorization.md` — secret inventory and matrix.
- `docs/operations/observability.md` — request IDs, JSON logs, Sentry.
- `docs/operations/backup-restore.md` — retention, restore, drill record.
- `docs/operations/performance-report.md` — capture-to-ticket measurements.
- `deploy/README.md` — tunnel, DNS, cache rules and external verification.
- `docs/adr/ADR-001-canvas-library.md` — React-Konva decision.
