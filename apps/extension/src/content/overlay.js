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

  // A single inline SVG mark keeps the logo crisp and independent of page CSP.
  // The eye inside a capture frame is the ARGUS "hundred-eyed watcher". The
  // gradient id is parameterised because the mark appears in both the popup
  // header and the floating button.
  const logoMark = (gradientId) => `
    <svg class="argus-logo-svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${gradientId}" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stop-color="#22d3ee"/>
          <stop offset="0.55" stop-color="#38bdf8"/>
          <stop offset="1" stop-color="#818cf8"/>
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="14" fill="url(#${gradientId})"/>
      <g fill="none" stroke="#020617" stroke-width="2.4" stroke-linecap="round" opacity="0.88">
        <path d="M10 18v-4a4 4 0 0 1 4-4h4"/>
        <path d="M30 10h4a4 4 0 0 1 4 4v4"/>
        <path d="M38 30v4a4 4 0 0 1-4 4h-4"/>
        <path d="M18 38h-4a4 4 0 0 1-4-4v-4"/>
      </g>
      <path d="M12 24c3.2-4.9 7.1-7.4 12-7.4S32.8 19.1 36 24c-3.2 4.9-7.1 7.4-12 7.4S15.2 28.9 12 24Z" fill="#020617" opacity="0.92"/>
      <circle cx="24" cy="24" r="4.2" fill="url(#${gradientId})"/>
      <circle cx="24" cy="24" r="1.7" fill="#020617"/>
      <circle cx="22.7" cy="22.7" r="0.7" fill="#e0f2fe" opacity="0.9"/>
    </svg>`;

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
          <span class="argus-logo">${logoMark("argus-logo-gradient-head")}</span>
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
      <span class="argus-fab-logo">${logoMark("argus-logo-gradient-fab")}</span>
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
    const first = await loadImage(frames[0].dataUrl);
    const scaleX = first.naturalWidth / metrics.viewportWidth;
    const scaleY = first.naturalHeight / metrics.viewportHeight;
    const width = Math.round(metrics.viewportWidth * scaleX);
    const height = Math.round(metrics.totalHeight * scaleY);

    if (width > 32000 || height > 32000) {
      throw new Error(
        "The stitched image would exceed the browser canvas limit.",
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to stitch the capture.");
    }

    for (const frame of frames) {
      const image = await loadImage(frame.dataUrl);
      context.drawImage(
        image,
        0,
        Math.round(frame.scrollY * scaleY),
        width,
        image.naturalHeight,
      );
    }

    return {
      dataUrl: canvas.toDataURL("image/png"),
      width,
      height,
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

  let hiddenElements = [];

  function restoreHiddenElements() {
    for (const element of hiddenElements) {
      const previous = element.getAttribute("data-argus-prev-visibility");
      const priority = element.getAttribute("data-argus-prev-priority") ?? "";
      if (previous) {
        element.style.setProperty("visibility", previous, priority);
      } else {
        element.style.removeProperty("visibility");
      }
      element.removeAttribute("data-argus-prev-visibility");
      element.removeAttribute("data-argus-prev-priority");
    }
    hiddenElements = [];
  }

  function prepareFullPageCapture() {
    restoreHiddenElements();
    document.getElementById("argus-fullpage-style")?.remove();

    return {
      totalHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
        window.innerHeight,
      ),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      dpr: window.devicePixelRatio,
    };
  }

  function hideFixedElements() {
    restoreHiddenElements();

    for (const element of document.querySelectorAll("body *")) {
      const position = getComputedStyle(element).position;
      if (position === "fixed" || position === "sticky") {
        element.setAttribute(
          "data-argus-prev-visibility",
          element.style.getPropertyValue("visibility"),
        );
        element.setAttribute(
          "data-argus-prev-priority",
          element.style.getPropertyPriority("visibility"),
        );
        element.style.setProperty("visibility", "hidden", "important");
        hiddenElements.push(element);
      }
    }

    return hiddenElements.length;
  }

  function restoreFullPageCapture(scroll) {
    restoreHiddenElements();
    document.getElementById("argus-fullpage-style")?.remove();

    if (scroll && Number.isFinite(scroll.x) && Number.isFinite(scroll.y)) {
      window.scrollTo(scroll.x, scroll.y);
    }
  }

  function scrollToPosition(y) {
    window.scrollTo(0, y);
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve(window.scrollY);
        });
      });
    });
  }

  function fullPageFrameCount(totalHeight, viewportHeight, maxFrames) {
    const frameCount = Math.max(
      1,
      Math.ceil(totalHeight / Math.max(1, viewportHeight)),
    );
    return {
      frameCount,
      exceedsLimit: frameCount > maxFrames,
      maxFrames,
    };
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

  function renderPreview(capture) {
    preview.hidden = false;
    preview.replaceChildren();

    const summary = document.createElement("p");
    summary.className = "argus-preview-meta";
    summary.textContent = `${capture.width} × ${capture.height} px · DPR ${capture.devicePixelRatio}${
      capture.mode === "full_page" ? " · full page" : ""
    }`;
    preview.append(summary);

    const image = document.createElement("img");
    image.src = capture.dataUrl;
    image.alt = "Capture preview";
    preview.append(image);

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
    const hasCaptures = totalCaptureCount() > 0;
    // When thumbnails already exist there is nothing useful to say in the
    // large preview slot; hide it instead of showing "No capture yet".
    preview.hidden = !message && hasCaptures;
    if (!preview.hidden) {
      const note = document.createElement("p");
      note.className = "argus-empty";
      note.textContent = message || "No capture yet.";
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
      item.className = `argus-thumb${entry.isCurrent ? " is-current" : ""}`;
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

      if (entry.isCurrent) {
        const badge = document.createElement("span");
        badge.className = "argus-thumb-badge";
        badge.textContent = "New";
        item.append(badge);
      }

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
      renderPreview(capture);
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
        const scrollY = await scrollToPosition(uniquePositions[index]);
        if (index === 1) {
          hideFixedElements();
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
      renderPreview(capture);
      setStatus(
        `Full page captured (${capture.width} × ${capture.height}).`,
        "ok",
      );
    } catch (error) {
      setStatus(describeCaptureError(error), "error");
    } finally {
      if (metrics) {
        restoreFullPageCapture({ x: metrics.scrollX, y: metrics.scrollY });
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
    restoreHiddenElements();
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
