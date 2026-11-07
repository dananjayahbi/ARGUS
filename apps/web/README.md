# ARGUS web application

Next.js application and PostgreSQL data layer for the ARGUS QA ecosystem.
This phase provides the application foundation, the migration workflow, the
typed database client, the §4 schema and the default `ARGUS` / `ARG` project
seed.

## Requirements

- Node.js 20 or newer (developed on Node 24)
- A reachable PostgreSQL database (the local build targets PostgreSQL 12.22)
- `DATABASE_URL` as the only required database environment variable

## Setup

From `apps/web`:

```powershell
npm install
Copy-Item .env.example .env.local
```

Set the required variables in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `WORKSPACE_TOKEN` | Shared secret the extension sends in `X-Workspace-Token` |
| `DRAFT_TOKEN_SECRET` | HMAC-SHA256 key for 30-minute canvas draft tokens |
| `CDN_BASE_URL` | Public origin of the Python CDN, no trailing slash |

All four are validated at server startup by `src/lib/env.ts` and the
`src/instrumentation.ts` hook. A missing or malformed value aborts startup
with a message naming every offending variable. Never commit `.env.local`; it
is covered by the repository `.gitignore`.

## Database commands

| Command | Purpose |
| --- | --- |
| `npm run db:migrate` | Apply every pending migration (non-interactive, CI-safe) |
| `npm run db:migrate:down` | Roll back the most recent migration |
| `npm run db:seed` | Idempotently insert the default `ARGUS` / `ARG` project |
| `npm run db:verify` | Assert the expected tables, foreign keys and indexes exist |

The migration runner loads `.env.local` when present, otherwise it uses the
process environment. `DATABASE_URL` is the only database variable it reads.

Migrations are plain SQL in `migrations/` and are executed by
`node-pg-migrate` v9. Up and down sections are separated by
`-- Up Migration` / `-- Down Migration` markers. They are the only supported
way to change the schema.

To roll back more than one migration, pass a count:

```powershell
node scripts/migrate.mjs down 2
```

To verify the schema after a rollback and re-apply:

```powershell
npm run db:verify
npm run db:migrate
npm run db:verify
```

## Local development

```powershell
npm run dev
```

Open http://localhost:3000. The current page is a foundation placeholder; the
ingestion APIs, canvas editor and Kanban dashboard arrive in later phases.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint over the whole app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:integration` | Integration tests against the `argus_test` database |
| `npm run test:ci` | Unit plus integration tests in one command |

The integration suite creates and migrates `argus_test` from `DATABASE_URL`,
or uses `TEST_DATABASE_URL` when set, and truncates issue tables between cases.
CI provisions a PostgreSQL 12 service and runs `npm run test:ci`.

The same commands run in CI (`.github/workflows/ci.yml`).

### Health check

`GET /api/healthz` validates the environment, runs `SELECT 1` and returns:

```json
{
  "status": "ok",
  "service": "argus-web",
  "database": { "reachable": true, "latency_ms": 12 },
  "timestamp": "2026-11-06T14:10:59.251Z"
}
```

If the database is unreachable the route returns `503` through the shared
error helper. API routes return errors in one shape:

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Database is not reachable."
  }
}
```

`src/lib/api-errors.ts` owns the code-to-status mapping and is the only place
API routes should build error responses. `src/app/error.tsx`,
`src/app/global-error.tsx` and `src/app/not-found.tsx` provide the UI
boundaries.

## UI theme

The web app shares the Chrome extension palette: deep teal chrome, warm amber
actions, cream page background, paper surfaces and the same muted ink text.
Design tokens live in `src/app/globals.css` inside Tailwind's `@theme` block
(`cream`, `paper`, `paper-2`, `line`, `ink`, `teal`, `accent`, `good`, `bad`).
Use those semantic utilities for new UI instead of raw slate/cyan/rose colors
so the two surfaces stay visually aligned.

The dashboard and canvas header bars use `bg-teal` with the ARGUS logo. Primary
actions use amber (`bg-accent`) or teal (`bg-teal`); destructive actions use
`bg-bad`. The canvas keeps its annotation defaults on the same palette: amber
pen, ink text with a paper background, and teal selection handles.

### Screenshot gallery

An annotated PNG is a flattened version of the primary capture, so the issue
detail gallery shows one card per screenshot. When both exist, the annotated
version is displayed first with an `Annotated` badge; opening the lightbox adds
an **Annotated / Original** toggle so the untouched capture stays one click
away. Supplementary captures remain separate cards.

### Issue conversation and notifications

The issue detail view is split in two: the existing issue content on the left
and a chronological QA ↔ developer conversation on the right. Comments support
Markdown, image attachments, audio (voice notes with no duration limit) and
document attachments (PDF and text/log files). Attachments are uploaded through
`POST /api/uploads` to the CDN; images use the `reconsider` category, audio uses
`audio`, and documents use `files`.

`POST /api/issues/[id]/comments` records the comment and fans out one
notification row for every other dashboard user. The header **Notifications**
button shows the unread count, opens a full-viewport activity feed, and marks an
item read when it is opened. The issue detail modal is layered above the feed,
so closing the issue returns to the notification list. Opening a notification
scrolls the conversation to the comment that triggered it.

## Data layer

`src/lib/db.ts` exports:

- `getPool()` — process-wide `pg.Pool`, stored on `globalThis` in development
  so Next.js hot reloads reuse it instead of creating connection storms.
- `query<T>()` — parameterized, typed query helper.
- `withTransaction()` — `BEGIN` / `COMMIT` / `ROLLBACK` wrapper.
- `closePool()` — used by short-lived scripts.

Row shapes and JSONB payload types live in `src/lib/db-types.ts`.

If `DATABASE_URL` is absent, the first database call throws a clear error
naming `apps/web/.env.local` and `apps/web/.env.example`. The module does not
throw at import time, so `next build` works without a live database.

## Schema summary

| Table | Purpose |
| --- | --- |
| `projects` | Workspace projects with a unique short key |
| `issues` | Bug reports, canvas state, telemetry and CDN asset URLs |
| `issue_reconsider_notes` | Developer/QA conversation for the Reconsider loop |
| `issue_supplementary_assets` | Clipboard-pasted secondary assets |
| `issue_comments` | Chronological issue conversation comments |
| `issue_comment_attachments` | Images, voice notes and documents attached to comments |
| `notifications` | Per-user comment notifications with read state |

Foreign keys cascade from `projects` to `issues`, from `issues` to the child
tables, and from `users` to sessions and notifications. Comment authors and
notification actors are nullable references to `users` with `ON DELETE SET
NULL`, so deleting an account preserves the conversation and its audit trail.

### Issue numbering decision

`issues.issue_number` is a single global `BIGSERIAL`. Project-scoped
uniqueness is enforced by `idx_project_issue_number` on
`(project_id, issue_number)`. Numbers are globally allocated, unique within a
project, and may contain gaps. There is no per-project counter and no
renumbering on delete. This resolves the tension between §4.1 (`BIGSERIAL`)
and §4.2 (project-scoped unique index).

## PostgreSQL 12 note

`gen_random_uuid()` requires the `pgcrypto` extension on PostgreSQL 12.
Migration `001` runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`, so the
migrating role needs permission to install extensions (the local `postgres`
role is a superuser). On PostgreSQL 13+ the function is built in and the
extension statement is a harmless no-op.
