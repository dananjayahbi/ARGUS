/**
 * ARGUS page overlay (injected into the page via executeScript files).
 * Renders a floating icon at the bottom-right corner. Clicking it opens a
 * compact popup dialog over the page. It never resizes or reflows the page.
 * Idempotent: injected once per page; the icon toggles the popup.
 */
(() => {
  if (document.getElementById("argus-overlay")) {
    document.getElementById("argus-overlay").remove();
  }

  const style = document.createElement("style");
  style.id = "argus-overlay-style";
  style.textContent = `
    #argus-overlay { position:fixed; right:16px; bottom:16px; z-index:2147483647; font-family: ui-sans-serif,system-ui,sans-serif; }
    #argus-overlay .argus-fab { width:52px; height:52px; border-radius:50%; border:2px solid #22d3ee; background:#0f172a; color:#22d3ee; font-size:20px; font-weight:700; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; }
    #argus-overlay .argus-popup { width:360px; max-width:calc(100vw - 32px); max-height:calc(100vh - 120px); overflow:auto; background:#0f172a; color:#e2e8f0; border:1px solid #334155; border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.6); margin-bottom:10px; overflow:hidden; }
    #argus-overlay .argus-popup-head { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid #1e293b; }
    #argus-overlay .argus-popup-title { font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:#22d3ee; font-weight:600; }
    #argus-overlay .argus-close { background:transparent; border:1px solid #334155; color:#cbd5e1; border-radius:6px; padding:4px 8px; cursor:pointer; font-size:12px; }
    #argus-overlay .argus-body { padding:12px 14px; }
    #argus-overlay .argus-status { font-size:12px; padding:8px 10px; border-radius:8px; background:#1e293b; margin-bottom:10px; }
    #argus-overlay .argus-status.ok { color:#4ade80; }
    #argus-overlay .argus-status.warn { color:#fbbf24; }
    #argus-overlay .argus-status.error { color:#fca5a5; }
    #argus-overlay .argus-btn { display:block; width:100%; margin:6px 0; padding:9px 10px; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; font-size:13px; cursor:pointer; text-align:center; }
    #argus-overlay .argus-btn.primary { background:#06b6d4; border-color:#06b6d4; color:#020617; font-weight:600; }
    #argus-overlay .argus-btn[disabled] { opacity:.45; cursor:not-allowed; }
    #argus-overlay .argus-muted { font-size:11px; color:#94a3b8; margin-top:8px; }
    #argus-overlay .argus-preview img { max-width:100%; border-radius:8px; border:1px solid #334155; margin-top:8px; }
    #argus-overlay .argus-capture-actions { display:flex; gap:6px; margin-top:8px; }
    #argus-overlay .argus-capture-actions .argus-btn { margin:0; flex:1; }
    #argus-overlay .argus-steps { font-size:11px; color:#94a3b8; margin:8px 0 0; padding-left:18px; }
  `;
  document.documentElement.appendChild(style);

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
        <button type="button" id="argus-area" class="argus-btn primary" disabled>Area snip</button>
        <button type="button" id="argus-full" class="argus-btn" disabled>Full page</button>
        <button type="button" id="argus-text" class="argus-btn" disabled>Text-only report</button>
        <button type="button" id="argus-harvest" class="argus-btn">Harvest now</button>
        <p class="argus-muted">Area snip and full page capture this tab. Text-only creates a pending issue without a screenshot.</p>
        <div id="argus-preview" class="argus-preview"></div>
        <div id="argus-capture-actions" class="argus-capture-actions" hidden>
          <button type="button" id="argus-use" class="argus-btn primary">Use this screenshot</button>
          <button type="button" id="argus-discard" class="argus-btn">Take another one</button>
        </div>
        <p id="argus-dispatch" class="argus-status" hidden></p>
      </div>
    </div>
    <button type="button" class="argus-fab" id="argus-fab" title="ARGUS QA Capture" aria-label="ARGUS QA Capture">A</button>
  `;
  document.documentElement.appendChild(root);

  const popup = root.querySelector("#argus-popup");
  const fab = root.querySelector("#argus-fab");
  const closeBtn = root.querySelector("#argus-close");
  const status = root.querySelector("#argus-status");
  const preview = root.querySelector("#argus-preview");
  const actions = root.querySelector("#argus-capture-actions");
  const dispatch = root.querySelector("#argus-dispatch");
  const buttons = {
    area: root.querySelector("#argus-area"),
    full: root.querySelector("#argus-full"),
    text: root.querySelector("#argus-text"),
    harvest: root.querySelector("#argus-harvest"),
    use: root.querySelector("#argus-use"),
    discard: root.querySelector("#argus-discard"),
  };

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.className = `argus-status${tone ? ` ${tone}` : ""}`;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get("argus.settings.v1");
    const settings = stored["argus.settings.v1"] ?? {};
    const configured = Boolean(
      settings.appBaseUrl &&
        settings.cdnBaseUrl &&
        settings.workspaceToken &&
        settings.cdnToken &&
        settings.projectId,
    );
    buttons.area.disabled = !configured;
    buttons.full.disabled = !configured;
    buttons.text.disabled = !configured;
    if (configured) {
      setStatus(`Ready · ${settings.appBaseUrl}`, "ok");
    } else {
      setStatus(
        "Configure the extension first (Settings), then paste values from the dashboard ⚙ Configurations.",
        "warn",
      );
    }
    return settings;
  }

  function showPopup() {
    popup.hidden = false;
    void loadSettings();
  }

  function hidePopup() {
    popup.hidden = true;
  }

  fab.addEventListener("click", () => {
    if (popup.hidden) {
      showPopup();
    } else {
      hidePopup();
    }
  });
  closeBtn.addEventListener("click", hidePopup);

  buttons.area.addEventListener("click", async () => {
    setStatus("Drag a rectangle on the page…");
  });

  buttons.discard.addEventListener("click", () => {
    preview.replaceChildren();
    actions.hidden = true;
    setStatus("No capture yet.");
  });

  buttons.use.addEventListener("click", () => {
    dispatch.hidden = false;
    dispatch.textContent =
      "Dispatch runs in the side panel. Open the ARGUS toolbar icon for upload steps.";
    dispatch.className = "argus-status warn";
  });

  buttons.harvest.addEventListener("click", () => {
    setStatus("Harvest runs in the side panel. Open the ARGUS toolbar icon for diagnostics.");
  });

  buttons.text.addEventListener("click", () => {
    setStatus("Text-only report runs in the side panel. Open the ARGUS toolbar icon to submit.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hidePopup();
    }
  });

  // Keep the original message-based capture hook working for the side panel.
  window.__ARGUS_OVERLAY__ = {
    toggle: () => (popup.hidden ? showPopup() : hidePopup()),
    close: hidePopup,
  };
})();
