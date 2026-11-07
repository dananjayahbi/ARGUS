# ARGUS Chrome extension (Manifest V3)

Side-panel capture extension for the ARGUS QA workflow.

## Build

From `apps/extension`:

```powershell
npm run build
npm run check
```

The loadable extension is written to `dist/`. `dist/` is gitignored.

## Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `apps/extension/dist`.
4. Click the ARGUS toolbar icon to open the side panel.
5. Open **Settings** and enter:
   - **App base URL**: `http://localhost:13130`
   - **CDN base URL**: `http://127.0.0.1:18130`
   - **Workspace ingestion token**: `WORKSPACE_TOKEN` from `apps/web/.env.local`
   - **CDN upload token**: `CDN_AUTH_TOKEN` from `apps/cdn/.env`
   - **Project ID**: the UUID of the ARGUS project row

Settings live in `chrome.storage.local` on this machine. Tokens are never
written to source, logged, or included in the build.

## Current scope

This is the task 1-2 scaffold:

- Manifest V3 with `sidePanel`, `activeTab`, `scripting`, `storage` and host
  permissions.
- Service worker opens the side panel from the toolbar action.
- Options page persists the app/CDN URLs, both tokens and the project ID.
- Side panel shell with capture buttons disabled until the capture engines land.
- Diagnostics harvester injected into the active tab: URL, title, viewport,
  screen, DPR, OS, browser/engine and an ISO-8601 timestamp, plus a rolling
  50-entry buffer of console errors, warnings, unhandled rejections and
  HTTP >= 400 fetch/XHR failures.
- High-DPI area snip: injects a crosshair overlay, captures the visible tab
  after the overlay is removed, and crops to the selection using the captured
  image's pixel scale. Escape cancels; the cropped PNG is cached for dispatch.
- Preview and dispatch: "Use this screenshot" uploads the raw PNG to the CDN,
  creates a draft through the app ingestion API with the harvested metadata and
  console logs, then opens the returned canvas editor URL in a new tab. "Take
  another one" discards the blob without any network calls. Per-step progress
  and actionable CDN/ingest errors are shown in the side panel.
- Text-only report: embedded title, Markdown description, priority slider and
  project selector. It creates a `text_only` draft, finalizes it directly to
  `pending` with the harvested environment and console logs, and links to the
  project board without opening the canvas or uploading an image.

The harvester is injected with `world: "MAIN"` because page `console` and
`fetch` can only be patched from the page's own JavaScript world. It exposes a
single `window.__ARGUS_HARVEST__.snapshot()` function and has no extension API
access; the side panel reads it through `chrome.scripting.executeScript`.

## Security notes

- No token value is committed; `check.mjs` rejects non-empty defaults.
- The extension only stores tokens in `chrome.storage.local`.
- Host permissions cover any web page (`http://*/*` and `https://*/*`),
  including local http pages such as `http://localhost:13130`.
