# Secrets, trust boundaries and authorization matrix

- **Status:** Active
- **Applies to:** `apps/web`, `apps/cdn`, `apps/extension`
- **Owner:** ARGUS engineering lead (rotate with the operator on call)

## 1. Secret inventory

Every value below is server-side only. None may be committed, logged, returned
in an API response, or referenced from a client component or `NEXT_PUBLIC_*`
variable.

| Secret | Used by | Deployment target | Storage | Rotation owner | Notes |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | `apps/web` | Mini PC app process; CI service | `apps/web/.env.local` locally, process environment in production | Engineering lead | Includes the Postgres password. Rotate the DB role password and redeploy both the app and backups. |
| `WORKSPACE_TOKEN` | `apps/web` ingest API; extension settings | Mini PC app process | `apps/web/.env.local` / process env; `chrome.storage.local` in the extension | Engineering lead | Shared workspace credential. Rotating it requires updating the extension options on each operator machine. |
| `DRAFT_TOKEN_SECRET` | `apps/web` canvas + upload draft tokens | Mini PC app process | `apps/web/.env.local` / process env | Engineering lead | Rotating it invalidates every outstanding 30-minute draft link. |
| `CDN_AUTH_TOKEN` | `apps/cdn` upload API; `apps/web` upload proxy; extension settings | Mini PC CDN process | `apps/cdn/.env` / process env; `chrome.storage.local` | Engineering lead | Rotate CDN and web together, then update extension settings. |
| `SESSION_SECRET` | `apps/web` session JWT signing | Mini PC app process | `apps/web/.env.local` / process env | Engineering lead | Rotating it signs every dashboard user out. DB session rows remain until they expire. |
| `QA_PASSWORD` | `apps/web` seed account | Mini PC app process | `apps/web/.env.local` / process env | QA lead | Used once to seed `QA_EMAIL`; changing the env value does not reset an existing hash. |
| `DEVELOPER_PASSWORD` | `apps/web` seed account | Mini PC app process | `apps/web/.env.local` / process env | Developer lead | Same seed-only behaviour as `QA_PASSWORD`. |
| Cloudflare Tunnel token / credentials | Cloudflare Tunnel on the Mini PC | Mini PC host | `cloudflared` service configuration (not in this repo) | Engineering lead | Covered by group 7 task 3. |

The extension stores only `WORKSPACE_TOKEN` and `CDN_AUTH_TOKEN` in
`chrome.storage.local`. It never stores the database URL, draft-token secret or
session secret.

## 2. Environment contract per deployment target

### Local development (`apps/web/.env.local`, `apps/cdn/.env`)

- `DATABASE_URL`, `WORKSPACE_TOKEN`, `DRAFT_TOKEN_SECRET`, `CDN_AUTH_TOKEN`,
  `CDN_BASE_URL`, `SESSION_SECRET`, `QA_EMAIL`, `QA_PASSWORD`,
  `DEVELOPER_EMAIL`, `DEVELOPER_PASSWORD`.
- Both files are gitignored. `.env.example` documents the shape with
  placeholders only.

### Production (Mini PC behind Cloudflare Tunnel)

- Secrets are injected as process environment variables by the service manager
  or an untracked env file readable only by the service account.
- `CDN_BASE_URL` is the public HTTPS CDN origin; the daemon itself binds
  `127.0.0.1`.
- `NODE_ENV=production` so session cookies are `Secure`.
- CI receives synthetic values only (see `.github/workflows/ci.yml`).

## 3. Startup validation

Both services reject missing or weak values before serving traffic:

- Web (`src/lib/env.ts`): `WORKSPACE_TOKEN`, `DRAFT_TOKEN_SECRET` and
  `CDN_AUTH_TOKEN` must be at least 32 characters, must not contain a
  documented placeholder marker, and must contain at least 8 distinct
  characters.
- CDN (`argus_cdn/config.py`): `CDN_AUTH_TOKEN` follows the same rules.
  Pydantic is configured with `hide_input_in_errors=True` so rejected values do
  not appear in startup error messages.
- `SESSION_SECRET` must be at least 32 characters (`auth-config.ts`).
- `npm run check:client-secrets` scans `.next/static` and `public/` after a
  production build and fails if any server secret value appears in client
  output. CI runs it after `npm run build`.

## 4. Trust boundaries

| Boundary | Credential | Reaches |
| --- | --- | --- |
| Chrome extension → app | `WORKSPACE_TOKEN` (`X-Workspace-Token`) | `POST /api/ingest/draft` |
| Chrome extension → CDN | `CDN_AUTH_TOKEN` (`X-CDN-Auth-Token`) | `POST /api/upload` |
| Browser canvas draft → app | 30-minute HMAC draft token (`?token=` or `Bearer`) | `/canvas/[draftId]`, `/api/uploads`, `/api/issues/[id]/finalize` |
| Dashboard user → app | `argus_session` httpOnly cookie (signed JWT + DB session) | `/dashboard`, `/projects/*`, `/api/issues/*`, `/api/issues/[id]/comments`, `/api/notifications*`, `/api/uploads` |
| Public | none | `/healthz`, `/login`, static assets |

## 5. Authorization matrix

Legend: ✅ allowed, ❌ denied (401/403), n/a route not reachable by that actor.
Every denied row is expected to make **no database write**.

| Route | Extension (`X-Workspace-Token`) | Anonymous draft holder (valid draft token) | QA user (session) | Developer user (session) | Anonymous |
| --- | --- | --- | --- | --- | --- |
| `POST /api/ingest/draft` | ✅ | ❌ | ❌ (no workspace token) | ❌ (no workspace token) | ❌ |
| `POST /api/upload` (CDN) | ✅ (`X-CDN-Auth-Token`) | n/a (extension/CDN credential) | n/a | n/a | ❌ |
| `POST /api/uploads` (web proxy) | ❌ | ✅ for its own issue only | ✅ | ✅ | ❌ |
| `PUT /api/issues/[id]/finalize` | ❌ | ✅ for its own issue only | ✅ | ✅ | ❌ |
| `POST /api/issues/[id]/reconsider` | ❌ | ❌ | ✅ (`qa` reply → `working`) | ✅ (note → `reconsider`) | ❌ |
| `PATCH /api/issues/[id]/status` | ❌ | ❌ | ✅ | ✅ | ❌ |
| `GET /api/issues/[id]` | ❌ | ❌ | ✅ | ✅ | ❌ |
| `GET /api/issues/[id]/notes` | ❌ | ❌ | ✅ | ✅ | ❌ |
| `GET /api/issues/[id]/comments` | ❌ | ❌ | ✅ | ✅ | ❌ |
| `POST /api/issues/[id]/comments` | ❌ | ❌ | ✅ (author role `qa`) | ✅ (author role `developer`) | ❌ |
| `GET /api/notifications` | ❌ | ❌ | ✅ (own feed only) | ✅ (own feed only) | ❌ |
| `POST /api/notifications/read` | ❌ | ❌ | ✅ (own items only) | ✅ (own items only) | ❌ |
| `GET /healthz` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /canvas/[draftId]?token=` | n/a | ✅ | ✅ (token still required) | ✅ (token still required) | ❌ |

Notes:

- A dashboard session does **not** replace the workspace token for ingestion:
  the extension is the only intended draft creator.
- The canvas route and draft-token uploads stay token-only; the dashboard
  cookie is not consulted there.
- Direct status transitions to `reconsider` are rejected by
  `PATCH /api/issues/[id]/status`; only the reconsider endpoint may make that
  transition.

## 6. Test coverage

- `apps/web/src/app/api/authorization-matrix.test.ts` asserts allowed and
  denied actors for ingest, finalize, reconsider and uploads.
- `apps/web/src/app/api/issues/[id]/status/route.test.ts` and
  `notes/route.test.ts` assert session protection.
- `apps/web/src/app/api/issues/[id]/comments/route.test.ts` and
  `apps/web/src/app/api/notifications/**/route.test.ts` assert session
  protection, input validation and notification fan-out. The integration suite
  additionally proves that a QA comment creates a developer notification and
  that read state is persisted.
- `apps/cdn/tests/test_auth.py` asserts missing, wrong and valid CDN tokens.
- `apps/web/src/lib/env.test.ts` and `apps/cdn/tests/test_config.py` assert
  weak and placeholder secrets are rejected without echoing the value.
