# ARGUS Chrome extension (Manifest V3)

In-page capture overlay for the ARGUS QA workflow.

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
3. Choose **Load unpacked** and select `apps/extension/dist`. (If you
   previously loaded an older build, click **Reload** on the ARGUS entry so
   the new `<all_urls>` permission and overlay content script take effect,
   then reload the test page itself.)
4. Any open http(s) web page now shows a floating **A** icon at the
   bottom-right corner. Click it to open the overlay popup (no page push,
   no layout shift). Click the toolbar icon for the same popup.
5. Open **Settings** and enter the five values (defaults already point at
   `http://localhost:13130` and `http://127.0.0.1:18130`):
   - **Workspace ingestion token**: `WORKSPACE_TOKEN` from `apps/web/.env.local`
   - **CDN upload token**: `CDN_AUTH_TOKEN` from `apps/cdn/.env`
   - **Project ID**: the UUID of the ARGUS project row

Settings live in `chrome.storage.local` on this machine. Tokens are never
written to source, logged, or included in the build.

## Current scope

The overlay is fully wired:

- Manifest V3 with `activeTab`, `scripting`, `storage`, `tabs` and host
  permissions. There is no side panel.
- A floating **A** icon is injected on every http(s) page, and the toolbar
  action toggles the same overlay popup.
- **⚙ Settings** in the popup opens the options page for the two tokens and
  the project ID, so configuration is reachable without remembering the
  toolbar menu.
- Options page persists the app/CDN URLs, both tokens and the project ID.
- **Area snip** draws a crosshair marquee over the page, captures the tab and
  crops to the selection at the captured image's pixel scale.
- **Full page** scrolls and stitches the whole document, hiding fixed/sticky
  elements after the first frame and restoring the page afterwards.
- **Text-only report** shows an inline title/description/priority form and
  creates a `text_only` issue that is finalized straight to Pending.
- **Harvest now** renders the page metadata and the latest console/network
  errors inside the popup.
- **Use this screenshot** uploads the raw PNG to the CDN, creates a draft and
  opens the canvas editor. When captures have been staged with **Add to
  issue**, it uploads every staged screenshot plus the current preview into a
  single draft and records the captured page URLs for each image. Staged
  captures live in `chrome.storage.session`, so you can move between pages
  before creating the issue. **Discard capture** drops only the current
  preview with no network calls; **+ Add another screenshot** in the captures
  list stages the current preview and immediately starts another area snip.
- Diagnostics harvester injected into the active tab: URL, title, viewport,
  screen, DPR, OS, browser/engine and an ISO-8601 timestamp, plus a rolling
  50-entry buffer of console errors, warnings, unhandled rejections and
  HTTP >= 400 fetch/XHR failures.

The harvester is injected with `world: "MAIN"` because page `console` and
`fetch` can only be patched from the page's own JavaScript world. It exposes a
single `window.__ARGUS_HARVEST__.snapshot()` function and has no extension API
access; the service worker reads it through `chrome.scripting.executeScript`
on behalf of the overlay.

Captures and network calls are coordinated by `background.js`
(`shared/background-handlers.js`): the overlay handles the DOM work (marquee,
crop, stitch) and asks the service worker for `captureVisibleTab`, the harvest
snapshot, opening the editor tab, and the CDN/ingest requests. Messages are
covered by `npm test` (`test-handlers.mjs`).

Overlay styles live in `content/overlay.css` and are declared in
`manifest.json` (and inserted with `chrome.scripting.insertCSS` for the
toolbar fallback). Do not inject a `<style>` element from the content script:
page `style-src` CSP blocks those, which previously made the floating button
invisible on every site except the CSP-less local app.

## Security notes

- No token value is committed; `check.mjs` rejects non-empty defaults.
- The extension only stores tokens in `chrome.storage.local`.
- Host permissions cover any web page (`http://*/*` and `https://*/*`),
  including local http pages such as `http://localhost:13130`.
