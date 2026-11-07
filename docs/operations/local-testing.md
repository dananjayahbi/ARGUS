# ARGUS local testing guide

This is the everyday, laptop-only way to run and test ARGUS.
Nothing here needs the Mini PC, Cloudflare, or Vercel.

## 0. Ports (our local convention)

We **always** use uncommon high ports locally so they never collide with the
default 3000 / 8080 dev servers:

| Service | URL | Why |
| --- | --- | --- |
| Web (Next.js app, canvas, dashboard, APIs) | `http://localhost:13130` | uncommon + high |
| CDN (Python asset daemon) | `http://127.0.0.1:18130` | uncommon + high |

Production (Mini PC + Cloudflare Tunnel) keeps the normal
`127.0.0.1:3000` / `127.0.0.1:8080` because the tunnel ingress maps to those.
Locally, you only ever use **13130** and **18130**.

Both services are loopback-only (`127.0.0.1`). They are not reachable from your
LAN. That's intentional for local testing.

## 1. One-time setup

From the repo root (`E:\My_GitHub_Repos\ARGUS` — adjust if your path differs):

```powershell
cd E:\My_GitHub_Repos\ARGUS

# Web app
cd apps\web
npm ci
Copy-Item .env.example .env.local   # only if .env.local doesn't exist yet
# edit .env.local: real DATABASE_URL + our dev tokens (already filled on this machine)

# Database (remote Postgres, already migrated on this machine — safe to re-run)
npm run db:migrate
npm run db:seed
npm run db:verify

cd ..\..
# CDN daemon
cd apps\cdn
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
Copy-Item .env.example .env         # only if .env doesn't exist yet
# edit .env to match apps\web\.env.local tokens (already filled on this machine)

cd ..\..
```

Verify your two env files agree on the CDN:

- `apps\cdn\.env` must have `PORT=18130` and `CDN_BASE_URL=http://127.0.0.1:18130`
- `apps\web\.env.local` must have `CDN_BASE_URL=http://127.0.0.1:18130` and the
  **same** `CDN_AUTH_TOKEN` as the CDN file

## 2. Start everything (two terminals, or use the script)

### Option A — one script (recommended)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local\start-local.ps1
```

That starts:

1. CDN → `http://127.0.0.1:18130`
2. Web in dev mode → `http://localhost:13130`

and then runs the health check for you. Logs + PID files:

```powershell
$env:TEMP\argus-local\   # cdn.out.log, cdn.err.log, web.out.log, web.err.log
```

If you already have a production build and want `next start` instead of
`next dev`:

```powershell
cd apps\web
npm run build
cd ..\..
powershell -ExecutionPolicy Bypass -File deploy\local\start-local.ps1 -Prod
```

Stop both:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local\stop-local.ps1
```

### Option B — manual (two PowerShell windows)

Window 1 — CDN:

```powershell
cd E:\My_GitHub_Repos\ARGUS\apps\cdn
.\.venv\Scripts\python -m argus_cdn
# reads PORT=18130 from .env, keep this window open
```

Window 2 — Web:

```powershell
cd E:\My_GitHub_Repos\ARGUS\apps\web
npm run dev -- -p 13130 -H 127.0.0.1
# or production:  npm run start -- -p 13130 -H 127.0.0.1
```

Wait until both say they're listening, then:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local\check-local.ps1
```

You should see `Web: OK` and `CDN: OK`.

## 3. Smoke-test the CDN standalone

The CDN is standalone. You can test it without the web app:

```powershell
# 1. Health
Invoke-RestMethod http://127.0.0.1:18130/healthz
# expect: status ok, service argus-cdn

# 2. Is it really on the high port and loopback-only?
Get-NetTCPConnection -LocalPort 18130 -State Listen | Select LocalAddress,LocalPort
# expect: 127.0.0.1  18130 and nothing on 8080

# 3. Fresh upload (uses the token from apps\cdn\.env)
$token = (Get-Content apps\cdn\.env | ? { $_ -match '^CDN_AUTH_TOKEN=' } | % { $_.Substring(14) })
curl.exe -H "X-CDN-Auth-Token: $token" -F "category=raw" -F "file=@$env:TEMP\test.png;type=image/png" http://127.0.0.1:18130/api/upload
# expect 201 and a JSON url like .../raw/2026/11/<uuid>_test.png
```

A 401 means the token is wrong — compare `apps\cdn\.env` and
`apps\web\.env.local`; they must be identical.

## 4. Test the full user flow

Open the browser:

1. **Login** — `http://localhost:13130/login`
   - QA: `qa@argus.local` / `qa-dev-password`
   - Developer: `dev@argus.local` / `dev-dev-password`
2. You land on **Dashboard**. Pick project **ARGUS (ARG)** in the project
   switcher if it isn't auto-selected.
3. **Kanban** shows 5 columns: Draft, Pending, Working, Reconsider, Completed.
   - Drag a card between columns (except to Reconsider — see step 5).
   - Click **Details** on any card to open the issue modal.
4. **Create a capture the programmatic way** (no extension needed):

```powershell
# read tokens once
$webEnv = Get-Content apps\web\.env.local -Raw
function Env($name) { [regex]::Match($webEnv, "(?m)^$name=(.+)$").Groups[1].Value.Trim() }
$ws = Env WORKSPACE_TOKEN
$cdnToken = Env CDN_AUTH_TOKEN
$cdnBase = Env CDN_BASE_URL   # http://127.0.0.1:18130
$web = "http://localhost:13130"
$proj = (psql (Env DATABASE_URL) -tAc "select id from projects where key='ARG'")

# a) upload a screenshot to the CDN
#    (use any PNG; screenshot.png in the repo root is fine)
$up = curl.exe -s -H "X-CDN-Auth-Token: $cdnToken" -F "category=raw" -F "file=@screenshot.png;type=image/png" "$cdnBase/api/upload" | ConvertFrom-Json
$rawUrl = $up.url

# b) create a draft issue
$draft = Invoke-RestMethod "$web/api/ingest/draft" -Method Post `
  -Headers @{"X-Workspace-Token"=$ws} -ContentType "application/json" `
  -Body (@{
    project_id=$proj; report_type="screenshot"; raw_image_url=$rawUrl
    environment_info=@{url="https://target.example/test"; viewport=@{width=1440;height=900}}
    console_logs=@()
  } | ConvertTo-Json -Depth 5)
$draft.issue_id; $draft.editor_url
```

5. **Canvas** — open `$draft.editor_url` in the browser (it's a
   tokenized link like `http://localhost:13130/canvas/<id>?token=...`).
   Draw one annotation, then **Submit**. The issue moves to **Pending**.
6. **Board** — go back to `http://localhost:13130/projects/ARG`. Your card
   should be in **Pending**. Click **Details** to see the screenshot,
   read-only canvas, diagnostics, and audit trail.
7. **Reconsider loop (Workflow B)**:
   - Developer: move the card to **Working**, then use the `reconsider`
     endpoint/modal with a note (a note is **mandatory**).
   - The card shows **Needs QA** in the Reconsider column.
   - QA: reply with a note → card returns to **Working**.
   - The Details modal shows both notes in chronological order.

Via API, the reconsider flow is:

```powershell
# login cookie (copy $cookie from the login response Set-Cookie header)
$login = Invoke-WebRequest "$web/api/auth/login" -Method Post -ContentType "application/json" `
  -Body '{"email":"dev@argus.local","password":"dev-dev-password"}' -SessionVariable s
$issueId = $draft.issue_id
Invoke-RestMethod "$web/api/issues/$issueId/reconsider" -Method Post -WebSession $s `
  -ContentType "application/json" -Body '{"author_role":"developer","note":"Cannot reproduce"}'
```

Empty note or calling the status API to `reconsider` directly returns **422**
by design.

## 5. Extension test (optional, needs Chrome)

```powershell
cd apps\extension
npm run check
npm run build
# then in chrome://extensions → Developer mode → Load unpacked → apps\extension\dist
```

Click **⚙ Settings** inside the floating popup (or open the extension
options page), then use the high ports:

- App base URL: `http://localhost:13130`
- CDN base URL: `http://127.0.0.1:18130`
- Workspace token / CDN token: same values as `apps\web\.env.local`
- Project: the ARG project UUID (`psql … -tAc "select id from projects where key='ARG'"`)

Then on any http(s) page: click the floating **A** (or the toolbar icon) →
**Harvest now** → **Area snip** → **Add to issue**. Repeat the capture for as
many screenshots as the issue needs, then choose **Use N screenshots** →
select an image in the canvas **Attached images** panel → annotate → Submit →
card appears on the board.

## 6. Automated gates (great for regression)

```powershell
cd apps\web
npm run test:e2e                # Workflow A: capture → pending
npm run test:e2e:reconsider     # Workflow B: reconsider loop
npm run test:perf               # 30-second budget report
npm run test                    # 118 unit tests
```

Each E2E gate provisions its own disposable database + temp storage, starts
both real services on free ports, and tears everything down. They do **not**
use 13130/18130 — they're fully isolated.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| CDN won't start: `CDN_AUTH_TOKEN must be at least 32 characters` | Token too short or a placeholder. Both env files must carry the same 32+ char token. |
| Web `401` on upload | `CDN_AUTH_TOKEN` differs between `apps\cdn\.env` and `apps\web\.env.local`, or `CDN_BASE_URL` isn't `http://127.0.0.1:18130`. |
| `Cannot find module` / port in use | Another service owns 13130/18130. `Get-NetTCPConnection -LocalPort 13130,18130` to see who. Stop it or change `-WebPort`/`-CdnPort`. |
| Login redirects to `/login` | Wrong password, or `DATABASE_URL` unreachable (remote PG). Re-run `npm run db:migrate` + `npm run db:seed`. |
| Canvas says "Draft link expired" | Tokens live 30 min. Re-capture to get a fresh one. |
| Extension says "Invalid draft payload" | Usually telemetry harvesting failed and an older build sent `0×0` viewport/screen dimensions. Rebuild and reload the extension; the current build omits unknown dimensions and the API response names the failing field. |
| Extension still shows only one screenshot | Rebuild (`npm run ext:build`) and reload the unpacked extension, then refresh the page. Use **Add to issue** to stage more captures before **Use N screenshots**. |
| `next dev` is very slow | Use production: `npm run build` then `start-local.ps1 -Prod`. |
| Nothing listens | Read `$env:TEMP\argus-local\*.log` — startup errors are there. |

## 8. Where things are

| What | Where |
| --- | --- |
| This guide | `docs/operations/local-testing.md` |
| Start/stop/check scripts | `deploy\local\start-local.ps1`, `stop-local.ps1`, `check-local.ps1` |
| CDN env / web env | `apps\cdn\.env`, `apps\web\.env.local` (templates: `.env.example`) |
| Production runbook | `docs/operations/runbook.md` |
| Tunnel / firewall / backup | `deploy\README.md`, `deploy\backup\`, `docs\operations\` |
