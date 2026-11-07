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

  // Styles come from content/overlay.css, declared in manifest.json and
  // inserted with chrome.scripting for the toolbar fallback. Injecting a
  // <style> element here would be blocked by page CSP on most sites.

  const root = document.createElement("div");
  root.id = "argus-overlay";
  root.innerHTML = `
    <div id="argus-popup" class="argus-popup" hidden>
      <div class="argus-popup-head">
        <span class="argus-popup-title">ARGUS QA capture</span>
        <button type="button" id="argus-close" class="argus-close">Close</button>
      </div>
      <div class="argus-body">
        <p id="argus-status" class="argus-status">Checking configuration…</p>
        <button type="button" id="argus-area" class="argus-btn primary">Area snip</button>
        <button type="button" id="argus-full" class="argus-btn">Full page</button>
        <button type="button" id="argus-text" class="argus-btn">Text-only report</button>
        <button type="button" id="argus-harvest" class="argus-btn">Harvest now</button>
        <button type="button" id="argus-settings" class="argus-btn ghost">⚙ Settings (tokens &amp; project)</button>
        <p class="argus-muted">Area snip and full page capture this tab. Text-only creates a pending issue without a screenshot.</p>

        <section id="argus-text-form" hidden>
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

        <section id="argus-staged" class="argus-staged">
          <div class="argus-staged-head">
            <span>Captures for this issue</span>
            <span id="argus-staged-count" class="argus-badge">0</span>
          </div>
          <div id="argus-staged-list" class="argus-staged-list"></div>
          <button type="button" id="argus-create-staged" class="argus-btn primary" hidden>
            Create issue with 0 screenshots
          </button>
          <button type="button" id="argus-clear-staged" class="argus-btn ghost" hidden>
            Clear all captures
          </button>
        </section>

        <div id="argus-preview" class="argus-preview"></div>
        <div id="argus-capture-actions" class="argus-capture-actions" hidden>
          <button type="button" id="argus-use" class="argus-btn primary">Use this screenshot</button>
          <button type="button" id="argus-add" class="argus-btn">Add to issue</button>
          <button type="button" id="argus-discard" class="argus-btn">Take another one</button>
        </div>
        <ol id="argus-steps" class="argus-steps" hidden></ol>
        <p id="argus-dispatch" class="argus-status" hidden></p>
        <div id="argus-diagnostics" class="argus-diagnostics" hidden></div>
      </div>
    </div>
    <button type="button" class="argus-fab" id="argus-fab" title="ARGUS QA Capture" aria-label="ARGUS QA Capture">A</button>
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
  const textForm = $("#argus-text-form");
  const textTitle = $("#argus-text-title");
  const textDescription = $("#argus-text-description");
  const textPriority = $("#argus-text-priority");
  const textPriorityLabel = $("#argus-text-priority-label");
  const textSubmit = $("#argus-text-submit");
  const textStatus = $("#argus-text-status");
  const stagedList = $("#argus-staged-list");
  const stagedCount = $("#argus-staged-count");
  const createStagedBtn = $("#argus-create-staged");
  const clearStagedBtn = $("#argus-clear-staged");
  const buttons = {
    area: $("#argus-area"),
    full: $("#argus-full"),
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

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The extension background service did not respond.",
      };
    }
  }

  function isPageCapturable() {
    return location.protocol === "http:" || location.protocol === "https:";
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get("argus.settings.v1");
    const saved = stored["argus.settings.v1"] ?? {};
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
    const configured = isConfigured(settings);
    const capturable = isPageCapturable();
    buttons.area.disabled = !configured || !capturable;
    buttons.full.disabled = !configured || !capturable;
    buttons.text.disabled = !configured;
    buttons.harvest.disabled = false;
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
    preview.replaceChildren();

    const summary = document.createElement("p");
    summary.className = "argus-status ok";
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
    updateCaptureButtons();
  }

  function clearPreview(message = "No capture yet.") {
    lastCapture = null;
    preview.replaceChildren();
    const note = document.createElement("p");
    note.className = "argus-muted";
    note.textContent = message;
    preview.append(note);
    actions.hidden = true;
    steps.hidden = true;
    steps.replaceChildren();
    setDispatchStatus("");
    updateCaptureButtons();
  }

  function captureTitle(capture) {
    return (
      capture?.snapshot?.environment_info?.title ||
      capture?.pageTitle ||
      capture?.pageUrl ||
      "Untitled capture"
    );
  }

  function totalCaptureCount() {
    return stagedCaptures.length + (lastCapture ? 1 : 0);
  }

  function updateCaptureButtons() {
    const total = totalCaptureCount();

    buttons.use.textContent =
      total > 1 ? `Use ${total} screenshots` : "Use this screenshot";
    buttons.add.disabled = !lastCapture || busy;
    buttons.add.hidden = !lastCapture;
    buttons.use.disabled = busy;
    buttons.discard.disabled = busy;

    stagedCount.textContent = String(stagedCaptures.length);
    createStagedBtn.hidden = stagedCaptures.length === 0;
    createStagedBtn.disabled = total === 0 || busy;
    createStagedBtn.textContent = `Create issue with ${total} screenshot${
      total === 1 ? "" : "s"
    }`;
    clearStagedBtn.hidden = stagedCaptures.length === 0;
    clearStagedBtn.disabled = busy;
  }

  function renderStagedCaptures() {
    stagedList.replaceChildren();

    if (stagedCaptures.length === 0) {
      const empty = document.createElement("p");
      empty.className = "argus-muted";
      empty.textContent =
        "No screenshots staged yet. Capture one, then choose Add to issue to keep it on this issue.";
      stagedList.append(empty);
    }

    stagedCaptures.forEach((capture, index) => {
      const item = document.createElement("div");
      item.className = "argus-staged-item";

      const image = document.createElement("img");
      image.src = capture.dataUrl;
      image.alt = `Staged capture ${index + 1}`;

      const label = document.createElement("span");
      label.className = "argus-staged-label";
      label.textContent = `#${index + 1} · ${captureTitle(capture)}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "argus-staged-remove";
      remove.title = "Remove this screenshot";
      remove.setAttribute("aria-label", `Remove screenshot ${index + 1}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        stagedCaptures = stagedCaptures.filter(
          (_, captureIndex) => captureIndex !== index,
        );
        void persistStagedCaptures();
        renderStagedCaptures();
      });

      item.append(image, label, remove);
      stagedList.append(item);
    });

    updateCaptureButtons();
  }

  async function persistStagedCaptures() {
    try {
      await chrome.storage.session.set({
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
    renderStagedCaptures();
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

      stagedCaptures = [];
      await persistStagedCaptures();
      renderStagedCaptures();
      clearPreview(
        `Issue created with ${captures.length} screenshot${
          captures.length === 1 ? "" : "s"
        }.`,
      );
      renderSteps(3);
      setDispatchStatus(
        "Draft created. The canvas editor is opening in a new tab.",
        "ok",
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

      setTextStatus("Text-only issue submitted to Pending.", "ok");
      const link = document.createElement("a");
      link.href = result.redirectUrl;
      link.className = "argus-link";
      link.textContent = "Open on the Kanban board";
      textStatus.append(" ", link);
      textTitle.value = "";
      textDescription.value = "";
      textPriority.value = "50";
      updatePriorityLabel();
    } finally {
      textSubmit.disabled = false;
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
    void refresh().catch(() => {
      setStatus("Unable to read extension settings.", "error");
    });
  }

  function hidePopup() {
    popup.hidden = true;
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
    textForm.hidden = !textForm.hidden;
    if (!textForm.hidden) {
      textTitle.focus();
    }
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
  clearStagedBtn.addEventListener("click", () => {
    clearStagedCaptures();
  });
  textPriority.addEventListener("input", updatePriorityLabel);
  textSubmit.addEventListener("click", () => {
    void submitTextReport();
  });

  const onEscape = (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      hidePopup();
    }
  };

  const onRuntimeMessage = (message) => {
    if (message?.type === "ARGUS_TOGGLE_OVERLAY") {
      togglePopup();
    }
  };

  document.addEventListener("keydown", onEscape);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function destroy() {
    document.removeEventListener("keydown", onEscape);
    try {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
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
  clearPreview();
  renderStagedCaptures();

  chrome.storage.session
    .get("argus.stagedCaptures")
    .then((stored) => {
      if (Array.isArray(stored["argus.stagedCaptures"])) {
        stagedCaptures = stored["argus.stagedCaptures"];
      }
      renderStagedCaptures();
    })
    .catch(() => {
      // Session storage may be unavailable; keep the in-memory list.
      renderStagedCaptures();
    });
})();
