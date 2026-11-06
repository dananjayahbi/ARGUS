# Observability: request IDs, logs and Sentry

- **Status:** Active
- **Applies to:** `apps/web`, `apps/cdn`
- **Owner:** ARGUS engineering lead

## 1. Request IDs

Every request gets a correlation id:

1. `apps/web/src/proxy.ts` reads an incoming `x-request-id` or generates a
   UUID. It forwards the header to route handlers and sets it on the response.
2. `apps/cdn/argus_cdn/observability.py` does the same for the CDN daemon.
3. `withApiObservability` in `apps/web/src/lib/observability.ts` reuses the
   forwarded id, logs the completion line and returns the header on the
   response. Unhandled API errors also include `error.request_id` in the JSON
   body.

The browser can read `x-request-id` from any API response and quote it in a
support report. That id appears in both the JSON log line and the Sentry event
tag (`request_id`).

## 2. JSON request logs

Both services emit one JSON object per request. The shared shape is:

```json
{
  "timestamp": "2026-11-06T17:42:57.658538+00:00",
  "level": "info",
  "service": "cdn",
  "event": "request",
  "request_id": "f2ab62fa-81ad-46b9-89d0-968ca94ca512",
  "method": "GET",
  "path": "/healthz",
  "status": 200,
  "duration_ms": 2.31
}
```

- Web API routes log from the observability wrapper after the handler returns.
- Web page/auth redirects log from the proxy.
- CDN requests log from `RequestContextMiddleware` after the response starts.
- Query strings, headers, cookies, request bodies, note bodies and tokens are
  never included. The CDN logs only the path, not the query string.

The web logger (`apps/web/src/lib/logger.ts`) additionally redacts keys
matching `token`, `secret`, `password`, `authorization`, `cookie`, `note`,
`body`, `dsn`, `database_url` and `api_key`, plus `Bearer` values.

## 3. Sentry

Sentry is the single error tracker for both runtimes.

- Web: `sentry.server.config.ts`, `sentry.edge.config.ts` and
  `src/instrumentation.ts`. `onRequestError` tags unhandled render, route,
  action and proxy errors with `request_id`, `router_kind`, `route_path` and
  `route_type`. API handlers also capture unexpected exceptions with the same
  tag.
- CDN: `argus_cdn/observability.py` initialises the FastAPI/Starlette
  integrations and tags the current scope with `request_id` and
  `service=cdn`. Unhandled exceptions are captured before the daemon returns a
  correlated 500.
- Both runtimes set `send_default_pii=false` and a `beforeSend` scrubber that
  removes request headers, cookies, bodies and query strings, deletes user and
  breadcrumb data, redacts sensitive `extra` keys and removes literal
  configured secret values from exception messages.
- Release and environment come from `SENTRY_RELEASE` and
  `SENTRY_ENVIRONMENT`; the defaults are `argus-web@0.1.0` /
  `argus-cdn@0.1.0` and `development`.

### DSN and retention

`SENTRY_DSN` is optional. When it is empty or unset, Sentry is not
initialised and both services start normally; this is the local and CI
default. Production sets the same DSN for web and CDN per environment.

Sentry retention is configured in the Sentry organisation/project settings,
not in application code: set **30 days** for both the `argus-web` and
`argus-cdn` projects. Changing retention is an operator action in the Sentry
UI and is recorded with the release notes.

### Local verification

- `npm run test` covers the web logger, Sentry scrubber and request wrapper.
- `pytest -m "not slow"` covers the CDN request log, request-id propagation,
  Sentry scrubber and correlated 500 response.
- `npm run check:client-secrets` (after `npm run build`) ensures no server
  secret reaches client output.
