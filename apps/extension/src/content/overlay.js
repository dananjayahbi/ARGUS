/**
 * ARGUS page overlay (injected into the page as a content script).
 *
 * Renders a floating icon at the bottom-right corner. Clicking it opens a
 * compact popup over the page. It never resizes or reflows the page.
 *
 * The overlay owns the DOM-heavy work (snip marquee, canvas crop, full-page
 * stitching) because content scripts have a DOM. Privileged operations
 * (captureVisibleTab, scripting, opening tabs, cross-origin uploads) are
 * delegated to the service worker over chrome.runtime messages.
 *
 * This file is a classic content script and must not use ES module imports.
 */
(() => {
  // Re-injection is idempotent: tear down any previous instance first so
  // document/runtime listeners do not accumulate.
  window.__ARGUS_OVERLAY__?.destroy?.();
  document.getElementById("argus-overlay")?.remove();

  const MAX_FULL_PAGE_FRAMES = 40;
  const fullPage = window.__ARGUS_FULLPAGE__;

  // Chrome tears down extension APIs in already-injected content scripts when
  // the extension is reloaded, updated or disabled. `chrome.runtime` then
  // becomes undefined, so reading `chrome.runtime.onMessage` throws
  // "Cannot read properties of undefined (reading 'onMessage')" and the
  // Extensions page reports it as an uncaught error. Detect the lost context
  // up front and degrade gracefully with a recovery hint instead of throwing.
  const CONTEXT_LOST_MESSAGE =
    "ARGUS lost its connection because the extension was reloaded or updated. Refresh this page (F5) to reconnect.";

  function getChromeApi() {
    return typeof chrome === "undefined" ? undefined : chrome;
  }

  function getRuntime() {
    return getChromeApi()?.runtime;
  }

  function getSessionStorage() {
    return getChromeApi()?.storage?.session;
  }

  function isExtensionAlive() {
    return Boolean(getRuntime()?.id);
  }

  function contextLostResult() {
    return { ok: false, error: CONTEXT_LOST_MESSAGE };
  }

  // Styles come from content/overlay.css, declared in manifest.json and
  // inserted with chrome.scripting for the toolbar fallback. Injecting a
  // <style> element here would be blocked by page CSP on most sites.

  // The provided ARGUS mark is embedded as a data URL so the overlay keeps its
  // branding even when the extension context is invalidated, and page CSP
  // cannot block it.
  const LOGO_DATA_URL = "data:image/png;base64,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";

  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

  const ICONS = {
    close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
    settings: icon(
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    ),
    crop: icon(
      '<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 8h8v8H8z"/>',
    ),
    full: icon(
      '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
    ),
    quick: icon('<path d="m4 12 16-8-5 16-3.5-6.5L4 12Z"/>'),
    text: icon('<path d="M4 6h16M4 11h12M4 16h16M4 21h9"/>'),
    harvest: icon('<path d="M3 12h3l2.5-6 4 12 2.5-6H21"/>'),
    plus: icon('<path d="M12 5v14M5 12h14"/>'),
  };

  const root = document.createElement("div");
  root.id = "argus-overlay";
  root.innerHTML = `
    <div id="argus-popup" class="argus-popup" hidden>
      <header class="argus-popup-head">
        <div class="argus-brand">
          <span class="argus-logo"><img class="argus-logo-img" src="${LOGO_DATA_URL}" alt="" /></span>
          <span class="argus-brand-copy">
            <span class="argus-brand-name">ARGUS</span>
            <span class="argus-brand-sub">QA capture</span>
          </span>
        </div>
        <div class="argus-head-actions">
          <button type="button" id="argus-settings" class="argus-icon-btn" title="Settings (tokens &amp; project)" aria-label="Settings (tokens and project)">${ICONS.settings}</button>
          <button type="button" id="argus-close" class="argus-icon-btn argus-close" title="Close" aria-label="Close">${ICONS.close}</button>
        </div>
      </header>
      <div class="argus-body">
        <p id="argus-status" class="argus-status" role="status">Checking configuration…</p>

        <section id="argus-default-actions" class="argus-action-zone">
          <button type="button" id="argus-area" class="argus-area-btn">
            <span class="argus-area-icon">${ICONS.crop}</span>
            <span class="argus-area-copy">
              <strong>Area snip</strong>
              <small>Drag a region on this page</small>
            </span>
            <span class="argus-area-badge">Start</span>
          </button>
          <div class="argus-action-grid">
            <button type="button" id="argus-full" class="argus-action" title="Capture the full page" aria-label="Capture the full page">${ICONS.full}<span>Full page</span></button>
            <button type="button" id="argus-quick" class="argus-action" title="Submit captures without annotation" aria-label="Quick submit">${ICONS.quick}<span>Quick submit</span></button>
            <button type="button" id="argus-text" class="argus-action" title="Create a report without a screenshot" aria-label="Text-only report">${ICONS.text}<span>Text only</span></button>
            <button type="button" id="argus-harvest" class="argus-action" title="Harvest console and network diagnostics" aria-label="Harvest diagnostics">${ICONS.harvest}<span>Harvest</span></button>
          </div>
          <p class="argus-hint">Area snip is the default action. The icons are compact shortcuts.</p>
        </section>

        <section id="argus-text-form" class="argus-form" hidden>
          <div class="argus-form-head">
            <div>
              <p class="argus-form-kicker">No screenshot</p>
              <h2>Text-only report</h2>
            </div>
            <button type="button" id="argus-text-cancel" class="argus-btn ghost compact">Cancel</button>
          </div>
          <div class="argus-field">
            <label for="argus-text-title">Title</label>
            <input type="text" id="argus-text-title" placeholder="Short bug title" />
          </div>
          <div class="argus-field">
            <label for="argus-text-description">Description (Markdown)</label>
            <textarea id="argus-text-description" placeholder="Steps, expected vs actual…"></textarea>
          </div>
          <div class="argus-field">
            <label for="argus-text-priority">Priority</label>
            <input type="range" id="argus-text-priority" min="0" max="100" step="1" value="50" />
            <span id="argus-text-priority-label" class="argus-priority">50% · Medium / Functional Flaw</span>
          </div>
          <button type="button" id="argus-text-submit" class="argus-btn primary">Submit text report</button>
          <p id="argus-text-status" class="argus-status" hidden></p>
        </section>

        <section id="argus-quick-form" class="argus-form" hidden>
          <div class="argus-form-head">
            <div>
              <p class="argus-form-kicker">No canvas needed</p>
              <h2>Quick submit</h2>
            </div>
            <button type="button" id="argus-quick-cancel" class="argus-btn ghost compact">Cancel</button>
          </div>
          <p id="argus-quick-summary" class="argus-muted">Submit the captured screenshots without opening the canvas editor.</p>
          <div class="argus-field">
            <label for="argus-quick-title">Title</label>
            <input type="text" id="argus-quick-title" placeholder="Short bug title" />
          </div>
          <div class="argus-field">
            <label for="argus-quick-description">Description (Markdown)</label>
            <textarea id="argus-quick-description" placeholder="Steps, expected vs actual…"></textarea>
          </div>
          <div class="argus-field">
            <label for="argus-quick-priority">Priority</label>
            <input type="range" id="argus-quick-priority" min="0" max="100" step="1" value="50" />
            <span id="argus-quick-priority-label" class="argus-priority">50% · Medium / Functional Flaw</span>
          </div>
          <button type="button" id="argus-quick-submit" class="argus-btn primary">Submit to Pending</button>
          <p id="argus-quick-status" class="argus-status" hidden></p>
        </section>

        <section id="argus-captures" class="argus-captures">
          <div class="argus-section-head">
            <span class="argus-section-title">Captures for this issue <span id="argus-staged-count" class="argus-badge">0</span></span>
            <button type="button" id="argus-clear-staged" class="argus-link-btn" hidden>Clear all</button>
          </div>
          <div id="argus-staged-list" class="argus-staged-list"></div>
          <button type="button" id="argus-add-more" class="argus-btn highlight" disabled>
            ${ICONS.plus}<span>Add another screenshot</span>
          </button>
          <button type="button" id="argus-create-staged" class="argus-btn primary" hidden>
            Create issue with 0 screenshots
          </button>
        </section>

        <div id="argus-preview" class="argus-preview"></div>
        <div id="argus-capture-actions" class="argus-capture-actions" hidden>
          <button type="button" id="argus-use" class="argus-btn primary">Use this screenshot</button>
          <button type="button" id="argus-add" class="argus-btn">Add to issue</button>
          <button type="button" id="argus-discard" class="argus-btn ghost">Discard capture</button>
        </div>
        <ol id="argus-steps" class="argus-steps" hidden></ol>
        <p id="argus-dispatch" class="argus-status" hidden></p>
        <div id="argus-diagnostics" class="argus-diagnostics" hidden></div>
      </div>
    </div>
    <button type="button" class="argus-fab" id="argus-fab" title="ARGUS QA Capture" aria-label="ARGUS QA Capture" aria-expanded="false">
      <span class="argus-fab-logo"><img class="argus-logo-img" src="${LOGO_DATA_URL}" alt="" /></span>
      <span class="argus-fab-dot" aria-hidden="true"></span>
    </button>
  `;
  document.documentElement.appendChild(root);

  const $ = (selector) => root.querySelector(selector);
  const popup = $("#argus-popup");
  const fab = $("#argus-fab");
  const closeBtn = $("#argus-close");
  const status = $("#argus-status");
  const preview = $("#argus-preview");
  const actions = $("#argus-capture-actions");
  const steps = $("#argus-steps");
  const dispatch = $("#argus-dispatch");
  const diagnostics = $("#argus-diagnostics");
  const defaultActions = $("#argus-default-actions");
  const textForm = $("#argus-text-form");
  const textTitle = $("#argus-text-title");
  const textDescription = $("#argus-text-description");
  const textPriority = $("#argus-text-priority");
  const textPriorityLabel = $("#argus-text-priority-label");
  const textSubmit = $("#argus-text-submit");
  const textStatus = $("#argus-text-status");
  const textCancel = $("#argus-text-cancel");
  const quickForm = $("#argus-quick-form");
  const quickTitle = $("#argus-quick-title");
  const quickDescription = $("#argus-quick-description");
  const quickPriority = $("#argus-quick-priority");
  const quickPriorityLabel = $("#argus-quick-priority-label");
  const quickSubmit = $("#argus-quick-submit");
  const quickStatus = $("#argus-quick-status");
  const quickSummary = $("#argus-quick-summary");
  const quickCancel = $("#argus-quick-cancel");
  const stagedList = $("#argus-staged-list");
  const stagedCount = $("#argus-staged-count");
  const addMoreBtn = $("#argus-add-more");
  const createStagedBtn = $("#argus-create-staged");
  const clearStagedBtn = $("#argus-clear-staged");
  const buttons = {
    area: $("#argus-area"),
    full: $("#argus-full"),
    quick: $("#argus-quick"),
    text: $("#argus-text"),
    harvest: $("#argus-harvest"),
    settings: $("#argus-settings"),
    use: $("#argus-use"),
    add: $("#argus-add"),
    discard: $("#argus-discard"),
  };

  const STEP_LABELS = ["Upload raw captures", "Create draft", "Open editor"];

  let settings = null;
  let lastCapture = null;
  let stagedCaptures = [];
  let busy = false;
  let activeMode = "default";

  function isFormOpen() {
    return activeMode === "text" || activeMode === "quick";
  }

  /**
   * Area snip is the default mode. Quick submit and Text report take over the
   * action area until the user cancels back to area snip (or submits).
   */
  function setMode(mode) {
    activeMode = mode;
    defaultActions.hidden = mode !== "default";
    textForm.hidden = mode !== "text";
    quickForm.hidden = mode !== "quick";
    buttons.text.className = `argus-action${mode === "text" ? " is-active" : ""}`;
    buttons.quick.className = `argus-action${mode === "quick" ? " is-active" : ""}`;
    if (mode === "text") {
      textTitle.focus();
    } else if (mode === "quick") {
      quickTitle.focus();
    } else {
      setTextStatus("");
      setQuickStatus("");
    }
  }

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.className = `argus-status${tone ? ` ${tone}` : ""}`;
  }

  function setDispatchStatus(message, tone = "") {
    dispatch.hidden = !message;
    dispatch.textContent = message;
    dispatch.className = `argus-status${tone ? ` ${tone}` : ""}`;
  }

  function setTextStatus(message, tone = "") {
    textStatus.hidden = !message;
    textStatus.textContent = message;
    textStatus.className = `argus-status${tone ? ` ${tone}` : ""}`;
  }

  function setQuickStatus(message, tone = "") {
    quickStatus.hidden = !message;
    quickStatus.textContent = message;
    quickStatus.className = `argus-status${tone ? ` ${tone}` : ""}`;
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function send(message) {
    const runtime = getRuntime();
    if (!runtime?.sendMessage) {
      return contextLostResult();
    }
    try {
      return await runtime.sendMessage(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      return {
        ok: false,
        error: /context invalidated/i.test(detail)
          ? CONTEXT_LOST_MESSAGE
          : detail || "The extension background service did not respond.",
      };
    }
  }

  function isPageCapturable() {
    return location.protocol === "http:" || location.protocol === "https:";
  }

  async function loadSettings() {
    let saved = {};
    const localStorageArea = getChromeApi()?.storage?.local;
    if (localStorageArea?.get) {
      try {
        const stored = await localStorageArea.get("argus.settings.v1");
        saved = stored?.["argus.settings.v1"] ?? {};
      } catch {
        // Extension context invalidated: fall back to the defaults so the
        // popup can still explain what happened.
      }
    }
    return {
      appBaseUrl: "http://localhost:13130",
      cdnBaseUrl: "http://127.0.0.1:18130",
      workspaceToken: "",
      cdnToken: "",
      projectId: "",
      ...saved,
    };
  }

  function isConfigured(value) {
    return Boolean(
      value?.appBaseUrl &&
        value?.cdnBaseUrl &&
        value?.workspaceToken &&
        value?.cdnToken &&
        value?.projectId,
    );
  }

  async function refresh() {
    settings = await loadSettings();
    if (!isExtensionAlive()) {
      setStatus(CONTEXT_LOST_MESSAGE, "warn");
      applyButtonState();
      return settings;
    }
    const configured = isConfigured(settings);
    const capturable = isPageCapturable();

    applyButtonState();

    if (!capturable) {
      setStatus(
        "This page cannot be captured. Open an http(s) page (including http://localhost) to use area snip or full page.",
        "warn",
      );
    } else if (configured) {
      setStatus(`Ready · ${settings.appBaseUrl}`, "ok");
    } else {
      setStatus(
        "Configure the extension first (Settings), then paste values from the dashboard ⚙ Configurations.",
        "warn",
      );
    }

    return settings;
  }

  function applyButtonState() {
    const alive = isExtensionAlive();
    const configured = isConfigured(settings);
    const capturable = isPageCapturable();
    buttons.area.disabled = !alive || !configured || !capturable;
    buttons.full.disabled = !alive || !configured || !capturable;
    buttons.quick.disabled = !alive || !configured;
    buttons.text.disabled = !alive || !configured;
    buttons.harvest.disabled = !alive;
    updateCaptureButtons();
  }

  // ---------------------------------------------------------------- cropping

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to read the capture."));
      image.src = dataUrl;
    });
  }

  async function cropDataUrl(dataUrl, rect) {
    const image = await loadImage(dataUrl);
    const scaleX = image.naturalWidth / rect.viewportWidth;
    const scaleY = image.naturalHeight / rect.viewportHeight;
    const width = Math.max(1, Math.round(rect.width * scaleX));
    const height = Math.max(1, Math.round(rect.height * scaleY));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to crop the capture.");
    }

    context.drawImage(
      image,
      rect.x * scaleX,
      rect.y * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
      0,
      0,
      width,
      height,
    );

    return {
      dataUrl: canvas.toDataURL("image/png"),
      width,
      height,
      mimeType: "image/png",
      capturedAt: new Date().toISOString(),
      viewport: { width: rect.viewportWidth, height: rect.viewportHeight },
      devicePixelRatio: rect.dpr,
    };
  }

  async function stitchFrames(frames, metrics) {
    if (!fullPage) {
      throw new Error(
        "Full-page capture runtime is missing. Reload the extension.",
      );
    }

    const first = await loadImage(frames[0].dataUrl);
    const layout = fullPage.computeStitchLayout(
      metrics,
      first.naturalWidth,
      first.naturalHeight,
    );

    if (layout.width > 32000 || layout.height > 32000) {
      throw new Error(
        "The stitched image would exceed the browser canvas limit.",
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to stitch the capture.");
    }

    for (const frame of frames) {
      const image = await loadImage(frame.dataUrl);
      context.drawImage(
        image,
        layout.sourceX,
        layout.sourceY,
        layout.sourceWidth,
        layout.sourceHeight,
        0,
        Math.round(frame.scrollY * layout.imageScaleY),
        layout.width,
        layout.sourceHeight,
      );
    }

    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: layout.width,
      height: layout.height,
      mimeType: "image/png",
      capturedAt: new Date().toISOString(),
      viewport: {
        width: metrics.viewportWidth,
        height: metrics.viewportHeight,
      },
      devicePixelRatio: metrics.dpr,
      mode: "full_page",
    };
  }

  // ----------------------------------------------------------- snip marquee

  function selectRectangle() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.setAttribute("data-argus-snip", "true");
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "cursor:crosshair",
        "background:transparent",
        "user-select:none",
      ].join(";");

      const selection = document.createElement("div");
      selection.style.cssText = [
        "position:absolute",
        "border:2px solid #22d3ee",
        "background:transparent",
        "box-shadow:0 0 0 9999px rgba(2,6,23,0.3)",
        "display:none",
        "pointer-events:none",
      ].join(";");

      const hint = document.createElement("div");
      hint.textContent = "Drag to capture · Esc to cancel";
      hint.style.cssText = [
        "position:absolute",
        "top:16px",
        "left:50%",
        "transform:translateX(-50%)",
        "padding:8px 12px",
        "border-radius:8px",
        "background:#020617",
        "color:#e2e8f0",
        "font:12px ui-sans-serif,system-ui,sans-serif",
        "border:1px solid #334155",
        "pointer-events:none",
      ].join(";");

      overlay.append(selection, hint);
      document.documentElement.appendChild(overlay);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const cleanup = () => {
        overlay.remove();
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
      };

      const finish = (rect) => {
        cleanup();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve(rect));
        });
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        selection.style.display = "block";
        selection.style.left = `${startX}px`;
        selection.style.top = `${startY}px`;
        selection.style.width = "0px";
        selection.style.height = "0px";
      };

      const onPointerMove = (event) => {
        if (!dragging) {
          return;
        }
        selection.style.left = `${Math.min(startX, event.clientX)}px`;
        selection.style.top = `${Math.min(startY, event.clientY)}px`;
        selection.style.width = `${Math.abs(event.clientX - startX)}px`;
        selection.style.height = `${Math.abs(event.clientY - startY)}px`;
      };

      const onPointerUp = (event) => {
        if (!dragging) {
          return;
        }
        dragging = false;

        const left = Math.max(0, Math.min(startX, event.clientX));
        const top = Math.max(0, Math.min(startY, event.clientY));
        const right = Math.min(
          window.innerWidth,
          Math.max(startX, event.clientX),
        );
        const bottom = Math.min(
          window.innerHeight,
          Math.max(startY, event.clientY),
        );
        const width = right - left;
        const height = bottom - top;

        if (width < 1 || height < 1) {
          finish(null);
          return;
        }

        finish({
          x: left,
          y: top,
          width,
          height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          dpr: window.devicePixelRatio,
        });
      };

      overlay.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("keydown", onKeyDown, true);
    });
  }

  // -------------------------------------------------------- full-page helpers

  function requireFullPageRuntime() {
    if (!fullPage) {
      throw new Error(
        "Full-page capture runtime is missing. Reload the extension.",
      );
    }
    return fullPage;
  }

  function prepareFullPageCapture() {
    return requireFullPageRuntime().prepareFullPageCapture();
  }

  function hideFixedElements(metrics) {
    return requireFullPageRuntime().hideFixedElements(metrics);
  }

  function restoreFullPageCapture(metrics) {
    requireFullPageRuntime().restoreFullPageCapture(metrics);
  }

  function scrollToPosition(metrics, y) {
    return requireFullPageRuntime().scrollToPosition(metrics, y);
  }

  function fullPageFrameCount(totalHeight, viewportHeight, maxFrames) {
    return requireFullPageRuntime().fullPageFrameCount(
      totalHeight,
      viewportHeight,
      maxFrames ?? MAX_FULL_PAGE_FRAMES,
    );
  }

  // ----------------------------------------------------------------- helpers

  function hideUiForCapture() {
    root.style.display = "none";
  }

  function showUiAfterCapture() {
    root.style.display = "";
  }

  function describeCaptureError(error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return (
      `Unable to capture this page${detail ? `: ${detail}` : ""}. ` +
      "Chrome cannot capture chrome://, extension, or other privileged pages. " +
      "If this is an http(s) page, reload it and try again."
    );
  }

  async function captureSnapshot() {
    const result = await send({ type: "ARGUS_GET_SNAPSHOT" });
    return result?.ok ? result.snapshot : null;
  }

  function renderPreview() {
    const total = totalCaptureCount();
    preview.hidden = false;
    preview.replaceChildren();

    // Every capture is shown at thumbnail size in the gallery. This strip is
    // only a compact count, never a second, larger rendering of one capture.
    const summary = document.createElement("p");
    summary.className = "argus-preview-meta";
    summary.textContent = `${total} screenshot${total === 1 ? "" : "s"} attached`;
    preview.append(summary);

    actions.hidden = false;
    steps.hidden = true;
    steps.replaceChildren();
    setDispatchStatus("");
    // Re-render the gallery so the newest capture appears as a thumbnail too.
    renderStagedCaptures();
  }

  function clearPreview(message = "") {
    lastCapture = null;
    preview.replaceChildren();
    preview.hidden = !message;
    if (message) {
      const note = document.createElement("p");
      note.className = "argus-empty";
      note.textContent = message;
      preview.append(note);
    }
    actions.hidden = true;
    steps.hidden = true;
    steps.replaceChildren();
    setDispatchStatus("");
    renderStagedCaptures();
  }

  function captureTitle(capture) {
    return (
      capture?.snapshot?.environment_info?.title ||
      capture?.pageTitle ||
      capture?.pageUrl ||
      "Untitled capture"
    );
  }

  /**
   * Every capture that belongs to the current issue, in visual order: the
   * screenshots staged with Add to issue first, then the latest capture. The
   * latest capture is deliberately included so the gallery always shows all
   * attached images, not only the ones that were explicitly staged.
   */
  function allCaptures() {
    const entries = stagedCaptures.map((capture, stagedIndex) => ({
      capture,
      stagedIndex,
      isCurrent: false,
    }));
    if (lastCapture) {
      entries.push({
        capture: lastCapture,
        stagedIndex: -1,
        isCurrent: true,
      });
    }
    return entries;
  }

  function totalCaptureCount() {
    return allCaptures().length;
  }

  function updateCaptureButtons() {
    const total = totalCaptureCount();
    const alive = isExtensionAlive();

    buttons.use.textContent =
      total > 1 ? `Use ${total} screenshots` : "Use this screenshot";
    buttons.add.disabled = !lastCapture || busy || !alive;
    buttons.add.hidden = !lastCapture;
    buttons.use.disabled = busy || !alive;
    buttons.discard.disabled = busy || !alive;

    stagedCount.textContent = String(total);
    addMoreBtn.disabled =
      busy || !alive || !isConfigured(settings) || !isPageCapturable();
    createStagedBtn.hidden = total === 0;
    createStagedBtn.disabled = total === 0 || busy || !alive;
    createStagedBtn.textContent = `Create issue with ${total} screenshot${
      total === 1 ? "" : "s"
    }`;
    clearStagedBtn.hidden = total === 0;
    clearStagedBtn.disabled = busy || !alive;
    quickSubmit.disabled = total === 0 || busy || !alive;
    quickSummary.textContent =
      total === 0
        ? "Capture a screenshot first, or use Text report instead."
        : `Submitting ${total} screenshot${
            total === 1 ? "" : "s"
          } without annotation.`;
  }

  function removeStagedCapture(stagedIndex) {
    stagedCaptures = stagedCaptures.filter((_, index) => index !== stagedIndex);
    void persistStagedCaptures();
    renderStagedCaptures();
  }

  function renderStagedCaptures() {
    stagedList.replaceChildren();
    const entries = allCaptures();

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "argus-empty";
      empty.textContent =
        "No screenshots yet. Start with Area snip, then add more here.";
      stagedList.append(empty);
    }

    entries.forEach((entry, index) => {
      const item = document.createElement("div");
      // Every capture is rendered identically: same size, same frame, no
      // "current" or "new" emphasis.
      item.className = "argus-thumb";
      item.title = captureTitle(entry.capture);

      const image = document.createElement("img");
      image.src = entry.capture.dataUrl;
      image.alt = `Capture ${index + 1}: ${captureTitle(entry.capture)}`;

      const label = document.createElement("span");
      label.className = "argus-thumb-index";
      label.textContent = `#${index + 1}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "argus-thumb-remove";
      remove.title = "Remove this screenshot";
      remove.setAttribute("aria-label", `Remove screenshot ${index + 1}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        if (entry.isCurrent) {
          clearPreview(`Removed capture #${index + 1}.`);
          return;
        }
        removeStagedCapture(entry.stagedIndex);
      });

      item.append(image, label, remove);
      stagedList.append(item);
    });

    updateCaptureButtons();
  }

  async function persistStagedCaptures() {
    const session = getSessionStorage();
    if (!session?.set) {
      return;
    }
    try {
      await session.set({
        "argus.stagedCaptures": stagedCaptures,
      });
    } catch {
      // Session storage has a quota; keep the in-memory copy if it is exceeded.
    }
  }

  async function addCurrentCapture() {
    if (!lastCapture) {
      return;
    }

    stagedCaptures = [...stagedCaptures, lastCapture];
    await persistStagedCaptures();
    renderStagedCaptures();
    clearPreview(
      `Screenshot added. ${stagedCaptures.length} capture${
        stagedCaptures.length === 1 ? "" : "s"
      } ready for this issue.`,
    );
    setStatus(
      "Capture another screenshot, or create the issue from the captures list.",
      "ok",
    );
  }

  function clearStagedCaptures() {
    stagedCaptures = [];
    void persistStagedCaptures();
    clearPreview("All captures cleared.");
  }

  /**
   * Reset every input and status after a report is created so the overlay is
   * immediately ready for the next issue instead of keeping the previous
   * captures, steps and success message on screen.
   */
  function resetForNextIssue(message) {
    stagedCaptures = [];
    void persistStagedCaptures();
    lastCapture = null;
    textTitle.value = "";
    textDescription.value = "";
    textPriority.value = "50";
    updatePriorityLabel();
    setTextStatus("");
    quickTitle.value = "";
    quickDescription.value = "";
    quickPriority.value = "50";
    updateQuickPriorityLabel();
    setQuickStatus("");
    setDispatchStatus("");
    steps.hidden = true;
    steps.replaceChildren();
    diagnostics.hidden = true;
    diagnostics.replaceChildren();
    setMode("default");
    clearPreview();
    if (message) {
      setStatus(message, "ok");
    }
  }

  async function captureAnother() {
    if (busy) {
      return;
    }
    if (lastCapture) {
      await addCurrentCapture();
    }
    await captureArea();
  }

  function renderSteps(activeIndex, errorIndex = -1) {
    steps.replaceChildren();
    STEP_LABELS.forEach((label, index) => {
      const item = document.createElement("li");
      item.textContent = label;
      if (index === errorIndex) {
        item.className = "error";
      } else if (index < activeIndex) {
        item.className = "done";
      } else if (index === activeIndex) {
        item.className = "active";
      }
      steps.append(item);
    });
    steps.hidden = false;
  }

  function priorityLabel(value) {
    if (value <= 25) return "Low / Cosmetic";
    if (value <= 50) return "Medium / Functional Flaw";
    if (value <= 75) return "High / Flow Blocked";
    return "Critical / System Blocker / Data Loss";
  }

  function updatePriorityLabel() {
    const value = Number(textPriority.value);
    textPriorityLabel.textContent = `${value}% · ${priorityLabel(value)}`;
  }

  function updateQuickPriorityLabel() {
    const value = Number(quickPriority.value);
    quickPriorityLabel.textContent = `${value}% · ${priorityLabel(value)}`;
  }

  function renderDiagnostics(snapshot) {
    diagnostics.replaceChildren();
    diagnostics.hidden = false;

    const environment = snapshot?.environment_info ?? {};
    const logs = Array.isArray(snapshot?.console_logs)
      ? snapshot.console_logs
      : [];

    const summary = document.createElement("p");
    summary.className = "argus-status ok";
    summary.textContent = `${logs.length} harvested entr${
      logs.length === 1 ? "y" : "ies"
    } · ${environment.url ?? "unknown URL"}`;
    diagnostics.append(summary);

    const meta = document.createElement("dl");
    const fields = [
      ["Title", environment.title],
      [
        "Viewport",
        environment.viewport
          ? `${environment.viewport.width} × ${environment.viewport.height}`
          : null,
      ],
      [
        "Screen",
        environment.screen
          ? `${environment.screen.width} × ${environment.screen.height}`
          : null,
      ],
      ["DPR", environment.device_pixel_ratio],
      ["OS", environment.os],
      [
        "Browser",
        environment.browser
          ? `${environment.browser.name} ${environment.browser.version}`
          : null,
      ],
      ["Timestamp", environment.timestamp],
    ];
    for (const [label, value] of fields) {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = String(value ?? "—");
      meta.append(term, detail);
    }
    diagnostics.append(meta);

    const list = document.createElement("ul");
    for (const log of logs.slice(-8)) {
      const item = document.createElement("li");
      item.textContent = `[${log.type}] ${log.timestamp} ${log.message}`;
      list.append(item);
    }
    diagnostics.append(list);

    if (logs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "argus-muted";
      empty.textContent = "No console or network errors captured yet.";
      diagnostics.append(empty);
    }
  }

  // --------------------------------------------------------------- workflows

  async function captureArea() {
    if (busy) return;
    if (!isPageCapturable()) {
      setStatus("This page cannot be captured. Open an http(s) page first.", "warn");
      return;
    }

    busy = true;
    buttons.area.disabled = true;
    buttons.full.disabled = true;
    popup.hidden = true;
    diagnostics.hidden = true;
    setStatus("Drag a rectangle on the page…");

    try {
      const rect = await selectRectangle();
      if (!rect) {
        setStatus("Capture cancelled.", "warn");
        return;
      }

      hideUiForCapture();
      await delay(120);
      const shot = await send({ type: "ARGUS_CAPTURE_VISIBLE" });
      if (!shot?.ok || !shot.dataUrl) {
        throw new Error(shot?.error || "Unable to capture this tab.");
      }

      const capture = await cropDataUrl(shot.dataUrl, rect);
      capture.pageUrl = location.href;
      capture.pageTitle = document.title;
      capture.mode = "area";
      capture.snapshot = await captureSnapshot();
      lastCapture = capture;
      renderPreview();
      setStatus(
        "Area captured. Review it, then use it or take another.",
        "ok",
      );
    } catch (error) {
      setStatus(describeCaptureError(error), "error");
    } finally {
      showUiAfterCapture();
      popup.hidden = false;
      busy = false;
      applyButtonState();
    }
  }

  async function captureFullPage() {
    if (busy) return;
    if (!isPageCapturable()) {
      setStatus("This page cannot be captured. Open an http(s) page first.", "warn");
      return;
    }

    busy = true;
    buttons.area.disabled = true;
    buttons.full.disabled = true;
    popup.hidden = true;
    diagnostics.hidden = true;

    let metrics = null;
    try {
      hideUiForCapture();
      metrics = prepareFullPageCapture();
      const { frameCount, exceedsLimit, maxFrames } = fullPageFrameCount(
        metrics.totalHeight,
        metrics.viewportHeight,
        MAX_FULL_PAGE_FRAMES,
      );
      if (exceedsLimit) {
        throw new Error(
          `This page needs ${frameCount} frames, exceeding the ${maxFrames}-frame limit.`,
        );
      }

      const positions = [];
      for (let index = 0; index < frameCount; index += 1) {
        positions.push(
          Math.min(
            index * metrics.viewportHeight,
            Math.max(0, metrics.totalHeight - metrics.viewportHeight),
          ),
        );
      }
      const uniquePositions = [...new Set(positions)];
      const frames = [];

      for (let index = 0; index < uniquePositions.length; index += 1) {
        const scrollY = await scrollToPosition(
          metrics,
          uniquePositions[index],
        );
        if (index === 1) {
          hideFixedElements(metrics);
        }
        await delay(550);

        const shot = await send({ type: "ARGUS_CAPTURE_VISIBLE" });
        if (!shot?.ok || !shot.dataUrl) {
          throw new Error(shot?.error || "Unable to capture this tab.");
        }
        frames.push({ dataUrl: shot.dataUrl, scrollY });
      }

      const capture = await stitchFrames(frames, metrics);
      capture.pageUrl = location.href;
      capture.pageTitle = document.title;
      capture.mode = "full_page";
      capture.snapshot = await captureSnapshot();
      lastCapture = capture;
      renderPreview();
      setStatus(
        `Full page captured (${capture.width} × ${capture.height}).`,
        "ok",
      );
    } catch (error) {
      setStatus(describeCaptureError(error), "error");
    } finally {
      if (metrics) {
        restoreFullPageCapture(metrics);
      }
      showUiAfterCapture();
      popup.hidden = false;
      busy = false;
      applyButtonState();
    }
  }

  async function dispatchCapture() {
    if (busy) return;

    const captures = [
      ...stagedCaptures,
      ...(lastCapture ? [lastCapture] : []),
    ];

    if (captures.length === 0) {
      setDispatchStatus("Capture a screenshot first.", "warn");
      return;
    }
    if (!settings || !isConfigured(settings)) {
      setDispatchStatus("Open Settings and complete the configuration first.", "warn");
      return;
    }

    busy = true;
    updateCaptureButtons();
    setDispatchStatus("");
    renderSteps(0);

    try {
      const result = await send({
        type: "ARGUS_DISPATCH",
        captures,
      });

      if (!result?.ok) {
        setDispatchStatus(result?.error ?? "Dispatch failed.", "error");
        renderSteps(result?.step ?? 0, result?.step ?? 0);
        return;
      }

      resetForNextIssue(
        `Issue created with ${captures.length} screenshot${
          captures.length === 1 ? "" : "s"
        }. Ready for the next report.`,
      );
    } finally {
      busy = false;
      updateCaptureButtons();
    }
  }

  async function submitTextReport() {
    const title = textTitle.value.trim();
    const description = textDescription.value;
    const priority = Number(textPriority.value);

    if (!title) {
      setTextStatus("A title is required.", "error");
      textTitle.focus();
      return;
    }
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      setTextStatus("Priority must be an integer from 0 to 100.", "error");
      return;
    }
    if (!settings || !isConfigured(settings)) {
      setTextStatus("Open Settings and complete the configuration first.", "warn");
      return;
    }

    textSubmit.disabled = true;
    setTextStatus("Creating text-only issue…", "");

    try {
      const result = await send({
        type: "ARGUS_TEXT_REPORT",
        projectId: settings.projectId,
        title,
        description,
        priority,
        environment: {
          url: location.href,
          title: document.title,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          screen: { width: window.screen.width, height: window.screen.height },
          device_pixel_ratio: window.devicePixelRatio,
          user_agent: navigator.userAgent,
          os: navigator.platform || "Unknown",
        },
      });

      if (!result?.ok) {
        setTextStatus(result?.error ?? "Text-only submission failed.", "error");
        return;
      }

      resetForNextIssue(
        "Text-only issue submitted to Pending. Ready for the next report.",
      );
    } finally {
      textSubmit.disabled = false;
    }
  }

  async function submitQuickReport() {
    if (busy) {
      return;
    }

    const title = quickTitle.value.trim();
    const description = quickDescription.value;
    const priority = Number(quickPriority.value);

    if (!title) {
      setQuickStatus("A title is required.", "error");
      quickTitle.focus();
      return;
    }
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      setQuickStatus("Priority must be an integer from 0 to 100.", "error");
      return;
    }

    const captures = [
      ...stagedCaptures,
      ...(lastCapture ? [lastCapture] : []),
    ];

    if (captures.length === 0) {
      setQuickStatus(
        "Capture a screenshot first, then use Quick submit.",
        "warn",
      );
      return;
    }
    if (!settings || !isConfigured(settings)) {
      setQuickStatus(
        "Open Settings and complete the configuration first.",
        "warn",
      );
      return;
    }

    busy = true;
    updateCaptureButtons();
    setQuickStatus("Submitting issue…", "");

    try {
      const result = await send({
        type: "ARGUS_QUICK_SUBMIT",
        projectId: settings.projectId,
        title,
        description,
        priority,
        captures,
      });

      if (!result?.ok) {
        setQuickStatus(result?.error ?? "Quick submit failed.", "error");
        return;
      }

      resetForNextIssue(
        `Issue submitted to Pending with ${captures.length} screenshot${
          captures.length === 1 ? "" : "s"
        }. Ready for the next report.`,
      );
    } finally {
      busy = false;
      updateCaptureButtons();
    }
  }

  async function harvest() {
    diagnostics.hidden = false;
    diagnostics.textContent = "Harvesting…";
    const result = await send({ type: "ARGUS_GET_SNAPSHOT" });
    if (!result?.ok) {
      diagnostics.textContent =
        result?.error ??
        "Unable to harvest this page. Only http(s) pages can be harvested.";
      return;
    }
    renderDiagnostics(result.snapshot);
    setStatus("Diagnostics harvested for this page.", "ok");
  }

  async function openSettings() {
    const result = await send({ type: "ARGUS_OPEN_OPTIONS" });
    if (!result?.ok) {
      setStatus(result?.error ?? "Unable to open the extension Settings.", "error");
      return;
    }
    setStatus(
      "Settings opened in a new tab. Paste the values from the dashboard ⚙ Configurations.",
      "ok",
    );
  }

  // ------------------------------------------------------------------ events

  function showPopup() {
    popup.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    void refresh().catch(() => {
      setStatus("Unable to read extension settings.", "error");
    });
  }

  function hidePopup() {
    popup.hidden = true;
    fab.setAttribute("aria-expanded", "false");
  }

  function togglePopup() {
    if (popup.hidden) {
      showPopup();
    } else {
      hidePopup();
    }
  }

  fab.addEventListener("click", togglePopup);
  closeBtn.addEventListener("click", hidePopup);

  buttons.area.addEventListener("click", () => {
    void captureArea();
  });
  buttons.full.addEventListener("click", () => {
    void captureFullPage();
  });
  buttons.text.addEventListener("click", () => {
    setMode(activeMode === "text" ? "default" : "text");
  });
  buttons.quick.addEventListener("click", () => {
    setMode(activeMode === "quick" ? "default" : "quick");
  });
  textCancel.addEventListener("click", () => {
    setMode("default");
  });
  quickCancel.addEventListener("click", () => {
    setMode("default");
  });
  buttons.harvest.addEventListener("click", () => {
    void harvest();
  });
  buttons.settings.addEventListener("click", () => {
    void openSettings();
  });
  buttons.use.addEventListener("click", () => {
    void dispatchCapture();
  });
  buttons.add.addEventListener("click", () => {
    void addCurrentCapture();
  });
  buttons.discard.addEventListener("click", () => {
    clearPreview();
  });
  createStagedBtn.addEventListener("click", () => {
    void dispatchCapture();
  });
  addMoreBtn.addEventListener("click", () => {
    void captureAnother();
  });
  clearStagedBtn.addEventListener("click", () => {
    clearStagedCaptures();
  });
  textPriority.addEventListener("input", updatePriorityLabel);
  textSubmit.addEventListener("click", () => {
    void submitTextReport();
  });
  quickPriority.addEventListener("input", updateQuickPriorityLabel);
  quickSubmit.addEventListener("click", () => {
    void submitQuickReport();
  });

  const onEscape = (event) => {
    if (event.key !== "Escape") {
      return;
    }
    // Escape first backs out of a report form to area snip, then closes the
    // popup on the next press.
    if (isFormOpen()) {
      event.preventDefault();
      setMode("default");
      return;
    }
    if (!popup.hidden) {
      hidePopup();
    }
  };

  const onRuntimeMessage = (message) => {
    if (message?.type === "ARGUS_TOGGLE_OVERLAY") {
      togglePopup();
    }
  };

  // The ARGUS canvas page asks the extension to close its tab after a
  // successful submit or a draft deletion. Page scripts cannot call
  // chrome.tabs directly, so it posts a message and the content script
  // forwards it to the service worker.
  const onWindowMessage = (event) => {
    if (event.source !== window) {
      return;
    }
    if (event.data?.type !== "ARGUS_CLOSE_CANVAS") {
      return;
    }
    void send({ type: "ARGUS_CLOSE_TAB" });
  };

  document.addEventListener("keydown", onEscape);
  window.addEventListener("message", onWindowMessage);
  try {
    getRuntime()?.onMessage?.addListener?.(onRuntimeMessage);
  } catch {
    // The extension context was invalidated before the overlay loaded; the
    // popup shows a reconnect hint and every action stays disabled.
  }

  function destroy() {
    document.removeEventListener("keydown", onEscape);
    window.removeEventListener("message", onWindowMessage);
    try {
      getRuntime()?.onMessage?.removeListener?.(onRuntimeMessage);
    } catch {
      // The extension context may already be invalidated.
    }
    document.querySelector('[data-argus-snip="true"]')?.remove();
    fullPage?.restoreHiddenElements?.();
    root.remove();
    delete window.__ARGUS_OVERLAY__;
  }

  window.__ARGUS_OVERLAY__ = {
    toggle: togglePopup,
    close: hidePopup,
    destroy,
  };

  updatePriorityLabel();
  updateQuickPriorityLabel();
  setMode("default");
  clearPreview();
  renderStagedCaptures();

  const sessionStorageArea = getSessionStorage();
  if (sessionStorageArea?.get) {
    sessionStorageArea
      .get("argus.stagedCaptures")
      .then((stored) => {
        if (Array.isArray(stored?.["argus.stagedCaptures"])) {
          stagedCaptures = stored["argus.stagedCaptures"];
        }
        // Recompute the empty preview state now that staged captures exist.
        clearPreview();
      })
      .catch(() => {
        // Session storage may be unavailable; keep the in-memory list.
        clearPreview();
      });
  }
})();
