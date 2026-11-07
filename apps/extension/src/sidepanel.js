import { isConfigured, loadSettings } from "./shared/config.js";
import { cropDataUrl, fullPageFrameCount, loadImage, stitchFrames } from "./shared/capture.js";
import { dispatchCapture as runDispatch } from "./shared/dispatch.js";
import { submitTextReport } from "./shared/text-report.js";
import { createSnipOverlay } from "./content/snip-overlay.js";
import {
  MAX_FULL_PAGE_FRAMES,
  hideFixedElements,
  prepareFullPageCapture,
  restoreFullPageCapture,
  scrollToPosition,
} from "./content/fullpage.js";

const statusText = document.querySelector("#status-text");
const openOptions = document.querySelector("#open-options");
const harvestButton = document.querySelector("#harvest");
const diagnosticsPreview = document.querySelector("#diagnostics-preview");
const captureAreaButton = document.querySelector("#capture-area");
const captureFullButton = document.querySelector("#capture-full");
const captureTextButton = document.querySelector("#capture-text");
const capturePreview = document.querySelector("#capture-preview");
const captureActions = document.querySelector("#capture-actions");
const useCaptureButton = document.querySelector("#use-capture");
const addCaptureButton = document.querySelector("#add-capture");
const discardCaptureButton = document.querySelector("#discard-capture");
const stagedCapturesEl = document.querySelector("#staged-captures");
const stagedCount = document.querySelector("#staged-count");
const clearStagedButton = document.querySelector("#clear-staged");
const createStagedButton = document.querySelector("#create-staged");
const dispatchSteps = document.querySelector("#dispatch-steps");
const dispatchStatus = document.querySelector("#dispatch-status");
const textReport = document.querySelector("#text-report");
const textProject = document.querySelector("#text-project");
const textTitle = document.querySelector("#text-title");
const textDescription = document.querySelector("#text-description");
const textPriority = document.querySelector("#text-priority");
const textPriorityLabel = document.querySelector("#text-priority-label");
const textSubmit = document.querySelector("#text-submit");
const textStatus = document.querySelector("#text-status");
const textSuccess = document.querySelector("#text-success");

let lastCapture = null;
let stagedCaptures = [];
let dispatching = false;

async function refresh() {  const settings = await loadSettings();
  const configured = isConfigured(settings);

  captureAreaButton.disabled = !configured;
  captureFullButton.disabled = !configured;
  captureTextButton.disabled = !configured;
  populateProject(settings);

  if (configured) {
    statusText.textContent = `Ready · ${settings.appBaseUrl}`;
    statusText.className = "status ok";
  } else {
    statusText.textContent =
      "Open Settings and enter the app URL, CDN URL, workspace token, CDN token and project ID.";
    statusText.className = "status warn";
  }
}

function populateProject(settings) {
  textProject.replaceChildren();
  const option = document.createElement("option");
  option.value = settings.projectId ?? "";
  option.textContent = settings.projectId
    ? `Configured project (${settings.projectId.slice(0, 8)}…)`
    : "Configure a project in Settings";
  option.disabled = !settings.projectId;
  textProject.append(option);
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

function setTextStatus(message, tone = "") {
  textStatus.textContent = message;
  textStatus.className = `status${tone ? ` ${tone}` : ""}`;
}

async function handleTextSubmit() {
  const title = textTitle.value.trim();
  const description = textDescription.value;
  const priority = Number(textPriority.value);
  const projectId = textProject.value;

  if (!title) {
    setTextStatus("A title is required.", "error");
    textTitle.focus();
    return;
  }

  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    setTextStatus("Priority must be an integer from 0 to 100.", "error");
    return;
  }

  if (!projectId) {
    setTextStatus("Select a project.", "error");
    return;
  }

  const settings = await loadSettings();
  if (!isConfigured(settings)) {
    setTextStatus(
      "Open Settings and complete the configuration first.",
      "warn",
    );
    return;
  }

  textSubmit.disabled = true;
  setTextStatus("Creating text-only issue…", "");
  textSuccess.hidden = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const snapshot = tab?.id
      ? await readHarvestSnapshot(tab.id).catch(() => null)
      : null;
    const environment = snapshot?.environment_info ?? {
      url: tab?.url ?? "",
      title: tab?.title ?? "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      device_pixel_ratio: window.devicePixelRatio,
      user_agent: navigator.userAgent,
      os: "Unknown",
    };
    const result = await submitTextReport({
      projectId,
      title,
      description,
      priority,
      environment,
      logs: Array.isArray(snapshot?.console_logs) ? snapshot.console_logs : [],
      settings,
    });

    if (!result.ok) {
      setTextStatus(result.error, "error");
      return;
    }

    setTextStatus("Text-only issue submitted to Pending.", "ok");
    const link = document.createElement("a");
    link.href = result.redirectUrl;
    link.textContent = "Open on the Kanban board";
    link.className = "success-link";
    textSuccess.replaceChildren(link);
    textSuccess.hidden = false;
    textTitle.value = "";
    textDescription.value = "";
    textPriority.value = "50";
    updatePriorityLabel();
  } catch (error) {
    setTextStatus(
      error instanceof Error ? error.message : "Text-only submission failed.",
      "error",
    );
  } finally {
    textSubmit.disabled = false;
  }
}

function renderDiagnostics(snapshot) {
  const environment = snapshot.environment_info ?? {};
  const logs = Array.isArray(snapshot.console_logs)
    ? snapshot.console_logs
    : [];

  diagnosticsPreview.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "status ok";
  summary.textContent = `${logs.length} harvested entr${
    logs.length === 1 ? "y" : "ies"
  } · ${environment.url ?? "unknown URL"}`;
  diagnosticsPreview.append(summary);

  const meta = document.createElement("dl");
  meta.className = "meta";
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
  diagnosticsPreview.append(meta);

  const list = document.createElement("ul");
  list.className = "log-list";
  for (const log of logs.slice(-8)) {
    const item = document.createElement("li");
    item.textContent = `[${log.type}] ${log.timestamp} ${log.message}`;
    list.append(item);
  }
  diagnosticsPreview.append(list);
}

async function readHarvestSnapshot(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["content/harvester.js"],
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => globalThis.__ARGUS_HARVEST__?.snapshot() ?? null,
  });

  return results?.[0]?.result ?? null;
}

async function harvestDiagnostics() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    diagnosticsPreview.textContent = "No active tab to harvest.";
    return;
  }

  try {
    const snapshot = await readHarvestSnapshot(tab.id);
    if (!snapshot) {
      diagnosticsPreview.textContent =
        "The page did not return a harvest snapshot.";
      return;
    }

    await chrome.storage.session.set({ "argus.lastSnapshot": snapshot });
    renderDiagnostics(snapshot);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    diagnosticsPreview.textContent =
      "Unable to harvest this page" +
      (detail ? `: ${detail}` : "") +
      ". Only http(s) pages (including http://localhost) can be harvested.";
  }
}

function renderCapture(capture) {
  capturePreview.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "status ok";
  summary.textContent = `${capture.width} × ${capture.height} px · DPR ${capture.devicePixelRatio}${capture.mode === "full_page" ? " · full page" : ""}`;

  const image = document.createElement("img");
  image.src = capture.dataUrl;
  image.alt = "Area capture preview";
  image.className = "capture-image";

  capturePreview.append(summary, image);
  captureActions.hidden = false;
  dispatchSteps.hidden = true;
  dispatchSteps.replaceChildren();
  setDispatchStatus("", "");
  updateCaptureActionLabels();
}

function stampCapture(capture, tab, snapshot) {
  capture.tabId = tab.id;
  capture.pageUrl = tab.url ?? capture.pageUrl ?? "";
  capture.snapshot = snapshot;
  capture.capturedAt = new Date().toISOString();
  capture.pageTitle = snapshot?.environment_info?.title ?? tab.title ?? "";
  return capture;
}

function captureTitle(capture) {
  return (
    capture?.snapshot?.environment_info?.title ||
    capture?.pageTitle ||
    capture?.pageUrl ||
    "Untitled capture"
  );
}

function updateCaptureActionLabels() {
  const total = stagedCaptures.length + (lastCapture ? 1 : 0);
  if (useCaptureButton) {
    useCaptureButton.textContent =
      total > 1 ? `Use ${total} screenshots` : "Use this screenshot";
  }
  if (addCaptureButton) {
    addCaptureButton.disabled = !lastCapture || dispatching;
  }
  if (clearStagedButton) {
    clearStagedButton.disabled = stagedCaptures.length === 0 || dispatching;
  }
  if (createStagedButton) {
    createStagedButton.disabled = total === 0 || dispatching;
    createStagedButton.textContent = `Create issue with ${total} screenshot${
      total === 1 ? "" : "s"
    }`;
  }
}

function renderStagedCaptures() {
  stagedCapturesEl.replaceChildren();
  stagedCount.textContent = String(stagedCaptures.length);

  if (stagedCaptures.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent =
      "No screenshots added yet. Capture a screenshot, then choose Add to issue to collect it here.";
    stagedCapturesEl.append(empty);
    updateCaptureActionLabels();
    return;
  }

  stagedCaptures.forEach((capture, index) => {
    const item = document.createElement("figure");
    item.className = "gallery-item";

    const image = document.createElement("img");
    image.src = capture.dataUrl;
    image.alt = `Staged capture ${index + 1}`;
    image.className = "gallery-thumb";

    const caption = document.createElement("figcaption");
    caption.className = "gallery-caption";

    const label = document.createElement("span");
    label.className = "gallery-label";
    label.textContent = `#${index + 1} · ${captureTitle(capture)}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = "Remove this screenshot";
    remove.setAttribute("aria-label", `Remove screenshot ${index + 1}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      stagedCaptures = stagedCaptures.filter(
        (_, captureIndex) => captureIndex !== index,
      );
      persistStagedCaptures();
      renderStagedCaptures();
    });

    caption.append(label, remove);
    item.append(image, caption);
    stagedCapturesEl.append(item);
  });

  updateCaptureActionLabels();
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

function clearStagedCaptures() {
  stagedCaptures = [];
  void persistStagedCaptures();
  renderStagedCaptures();
}

async function addCurrentCapture() {
  if (!lastCapture) {
    return;
  }

  stagedCaptures = [...stagedCaptures, lastCapture];
  lastCapture = null;
  await chrome.storage.session.remove("argus.lastCapture").catch(() => {});
  await persistStagedCaptures();

  capturePreview.replaceChildren();
  const message = document.createElement("p");
  message.className = "status ok";
  message.textContent = `Screenshot added. ${stagedCaptures.length} capture${
    stagedCaptures.length === 1 ? "" : "s"
  } ready for this issue.`;
  capturePreview.append(message);

  captureActions.hidden = true;
  dispatchSteps.hidden = true;
  dispatchSteps.replaceChildren();
  setDispatchStatus(
    "Take another screenshot, or use the captures above to create the issue.",
    "",
  );
  renderStagedCaptures();
}

const DISPATCH_STEPS = ["Upload raw captures", "Create draft", "Open editor"];

function renderDispatchSteps(activeIndex, errorIndex = -1) {
  dispatchSteps.replaceChildren();

  DISPATCH_STEPS.forEach((label, index) => {
    const item = document.createElement("li");
    item.textContent = label;

    if (index === errorIndex) {
      item.className = "error";
    } else if (index < activeIndex) {
      item.className = "done";
    } else if (index === activeIndex) {
      item.className = "active";
    }

    dispatchSteps.append(item);
  });

  dispatchSteps.hidden = false;
}

function setDispatchStatus(message, tone = "") {
  dispatchStatus.textContent = message;
  dispatchStatus.className = `status${tone ? ` ${tone}` : ""}`;
}

async function discardCapture() {
  lastCapture = null;
  await chrome.storage.session.remove("argus.lastCapture").catch(() => {});

  capturePreview.replaceChildren();
  const message = document.createElement("p");
  message.className = "muted";
  message.textContent = "No capture yet.";
  capturePreview.append(message);

  captureActions.hidden = true;
  dispatchSteps.hidden = true;
  dispatchSteps.replaceChildren();
  setDispatchStatus("", "");
  updateCaptureActionLabels();
}

async function dispatchCapture() {
  if (dispatching) {
    return;
  }

  const captures = [
    ...stagedCaptures,
    ...(lastCapture ? [lastCapture] : []),
  ];

  if (captures.length === 0) {
    setDispatchStatus("Capture a screenshot first.", "warn");
    return;
  }

  const settings = await loadSettings();
  if (!isConfigured(settings)) {
    setDispatchStatus(
      "Open Settings and complete the configuration first.",
      "warn",
    );
    return;
  }

  dispatching = true;
  useCaptureButton.disabled = true;
  addCaptureButton.disabled = true;
  discardCaptureButton.disabled = true;
  updateCaptureActionLabels();
  setDispatchStatus("", "");

  renderDispatchSteps(0);

  try {
    const result = await runDispatch({
      captures,
      settings,
      createTab: (url) => chrome.tabs.create({ url }),
      readSnapshot: (tabId) => readHarvestSnapshot(tabId),
      onStep: (step) => renderDispatchSteps(step),
    });

    if (!result.ok) {
      setDispatchStatus(result.error, "error");
      renderDispatchSteps(result.step, result.step);
      return;
    }

    stagedCaptures = [];
    lastCapture = null;
    await chrome.storage.session.remove("argus.lastCapture").catch(() => {});
    await persistStagedCaptures();
    renderStagedCaptures();

    capturePreview.replaceChildren();
    const message = document.createElement("p");
    message.className = "status ok";
    message.textContent = `Issue created with ${captures.length} screenshot${
      captures.length === 1 ? "" : "s"
    }.`;
    capturePreview.append(message);
    captureActions.hidden = true;

    renderDispatchSteps(3);
    setDispatchStatus(
      "Draft created. The canvas editor is opening in a new tab.",
      "ok",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatch failed.";
    setDispatchStatus(message, "error");
    renderDispatchSteps(0, 0);
  } finally {
    dispatching = false;
    useCaptureButton.disabled = false;
    discardCaptureButton.disabled = false;
    addCaptureButton.disabled = !lastCapture;
    updateCaptureActionLabels();
  }
}

function isCapturableUrl(url) {
  if (!url) return false;
  try {
    const scheme = new URL(url).protocol.replace(":", "");
    return scheme === "http" || scheme === "https";
  } catch {
    return false;
  }
}

function describeCaptureError(error, tabUrl) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (tabUrl && !isCapturableUrl(tabUrl)) {
    return (
      `This page (${tabUrl}) cannot be captured. ` +
      "Open any http(s) web page (including http://localhost and other local http pages) and try again." +
      (detail ? ` Details: ${detail}` : "")
    );
  }
  return (
    `Unable to capture this page${detail ? `: ${detail}` : ""}. ` +
    "If this is an http(s) page, reload it and try again. " +
    "Chrome cannot capture chrome://, extension, or other privileged pages."
  );
}

async function captureArea() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.windowId === undefined) {
    capturePreview.textContent = "No active tab to capture.";
    return;
  }

  if (!isCapturableUrl(tab.url)) {
    capturePreview.textContent =
      `This page (${tab.url ?? "unknown"}) cannot be captured. ` +
      "Open any http(s) web page — including http://localhost pages — and try again.";
    return;
  }

  capturePreview.textContent = "Drag a rectangle on the page…";

  let rect = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: createSnipOverlay,
    });
    rect = results?.[0]?.result;
  } catch (overlayError) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      const image = await loadImage(dataUrl).catch(() => null);
      if (!image) {
        capturePreview.textContent = describeCaptureError(overlayError, tab.url);
        return;
      }
      const capture = await cropDataUrl(dataUrl, {
        x: 0,
        y: 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
        viewportWidth: image.naturalWidth,
        viewportHeight: image.naturalHeight,
        dpr: 1,
      });
      capture.tabId = tab.id;
      capture.pageUrl = tab.url ?? "";
      stampCapture(
        capture,
        tab,
        await readHarvestSnapshot(tab.id).catch(() => null),
      );
      lastCapture = capture;
      await chrome.storage.session.set({ "argus.lastCapture": capture });
      renderCapture(capture);
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent =
        "Full-visible fallback — the snip overlay could not load on this page.";
      capturePreview.append(note);
      return;
    } catch {
      capturePreview.textContent = describeCaptureError(overlayError, tab.url);
      return;
    }
  }

  if (!rect) {
    capturePreview.textContent = "Capture cancelled.";
    return;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    const capture = await cropDataUrl(dataUrl, rect);
    capture.tabId = tab.id;
    capture.pageUrl = tab.url ?? "";
    stampCapture(
      capture,
      tab,
      await readHarvestSnapshot(tab.id).catch(() => null),
    );
    lastCapture = capture;
    await chrome.storage.session.set({ "argus.lastCapture": capture });
    renderCapture(capture);
  } catch {
    capturePreview.textContent =
      "Unable to capture this page. The extension may need reloading (chrome://extensions > Reload), then reload this page. Chrome cannot capture chrome://, extension, or other privileged pages.";
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function captureFullPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.windowId === undefined) {
    capturePreview.textContent = "No active tab to capture.";
    return;
  }

  if (!isCapturableUrl(tab.url)) {
    capturePreview.textContent =
      `This page (${tab.url ?? "unknown"}) cannot be captured. ` +
      "Open any http(s) web page — including http://localhost pages — and try again.";
    return;
  }

  capturePreview.textContent = "Preparing full-page capture…";
  let metrics = null;

  try {
    const prepared = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: prepareFullPageCapture,
    });
    metrics = prepared?.[0]?.result;
    if (!metrics) {
      throw new Error("Unable to prepare the page for capture.");
    }

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
      const y = uniquePositions[index];
      const scrolled = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrollToPosition,
        args: [y],
      });
      const scrollY = scrolled?.[0]?.result?.scrollY ?? y;

      if (index === 1) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: hideFixedElements,
        });
      }

      await delay(550);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      frames.push({ dataUrl, scrollY });
    }

    const capture = await stitchFrames(frames, metrics);
    capture.tabId = tab.id;
    capture.pageUrl = tab.url ?? "";
    stampCapture(
      capture,
      tab,
      await readHarvestSnapshot(tab.id).catch(() => null),
    );
    lastCapture = capture;
    renderCapture(capture);
    await chrome.storage.session
      .set({ "argus.lastCapture": capture })
      .catch(() => {});
  } catch (error) {
    capturePreview.textContent =
      error instanceof Error
        ? error.message
        : "Unable to capture the full page.";
  } finally {
    if (metrics) {
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: restoreFullPageCapture,
          args: [{ x: metrics.scrollX, y: metrics.scrollY }],
        })
        .catch(() => {});
    }
  }
}

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

harvestButton.addEventListener("click", () => {
  void harvestDiagnostics();
});

captureAreaButton.addEventListener("click", () => {
  void captureArea();
});

captureFullButton.addEventListener("click", () => {
  void captureFullPage();
});

captureTextButton.addEventListener("click", () => {
  textReport.open = true;
  textTitle.focus();
  textReport.scrollIntoView({ behavior: "smooth", block: "start" });
});

textPriority.addEventListener("input", updatePriorityLabel);

textSubmit.addEventListener("click", () => {
  void handleTextSubmit();
});

useCaptureButton.addEventListener("click", () => {
  void dispatchCapture();
});

addCaptureButton.addEventListener("click", () => {
  void addCurrentCapture();
});

clearStagedButton.addEventListener("click", () => {
  clearStagedCaptures();
});

createStagedButton.addEventListener("click", () => {
  void dispatchCapture();
});

discardCaptureButton.addEventListener("click", () => {
  void discardCapture();
});

chrome.storage.session
  .get(["argus.lastCapture", "argus.stagedCaptures"])
  .then((stored) => {
    if (Array.isArray(stored["argus.stagedCaptures"])) {
      stagedCaptures = stored["argus.stagedCaptures"];
    }
    if (stored["argus.lastCapture"]) {
      lastCapture = stored["argus.lastCapture"];
      renderCapture(stored["argus.lastCapture"]);
    }
    renderStagedCaptures();
  })
  .catch(() => {
    // Session storage may be unavailable in older Chromium builds.
    renderStagedCaptures();
  });

refresh().catch(() => {
  statusText.textContent = "Unable to read extension settings.";
  statusText.className = "status error";
});

updatePriorityLabel();
renderStagedCaptures();
