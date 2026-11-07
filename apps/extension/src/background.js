// ARGUS overlay controller (runs in the service worker).
// A floating icon is injected on every http(s) page; clicking it opens the
// compact capture popup over the page. No side panel is opened.
//
// The popup is a content script and therefore cannot call privileged chrome
// APIs (captureVisibleTab, scripting, tabs) or make CORS-safe cross-origin
// requests. It delegates those operations here over chrome.runtime messages.

import { isConfigured, loadSettings } from "./shared/config.js";
import { dispatchCapture } from "./shared/dispatch.js";
import { submitTextReport } from "./shared/text-report.js";
import { createMessageHandler } from "./shared/background-handlers.js";

// The overlay (a content script) stages screenshots in storage.session so a
// multi-page capture survives navigation. Session storage is restricted to
// trusted contexts by default, so expose it to content scripts explicitly.
try {
  chrome.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch(() => {});
} catch {
  // Older Chromium builds may not support setAccessLevel.
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

async function getSnapshot(tabId) {
  if (!tabId) {
    return null;
  }

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

async function openOverlay(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ARGUS_TOGGLE_OVERLAY" });
  } catch {
    // No content script yet (e.g. a page loaded before install/reload):
    // insert the stylesheet explicitly, since a <style> element created by the
    // script would be blocked by page CSP on most sites.
    await chrome.scripting
      .insertCSS({
        target: { tabId },
        files: ["content/overlay.css"],
      })
      .catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/overlay.js"],
    });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    return;
  }

  if (!isCapturableUrl(tab.url)) {
    try {
      const settings = (await chrome.storage.local.get("argus.settings.v1"))?.[
        "argus.settings.v1"
      ];
      await chrome.tabs.create({
        url: settings?.appBaseUrl ?? "http://localhost:13130",
      });
    } catch {
      // No settings yet; nothing to open.
    }
    return;
  }

  try {
    await openOverlay(tab.id);
  } catch {
    // The injected overlay handles its own errors; nothing to do here.
  }
});

const handleMessage = createMessageHandler({
  loadSettings,
  isConfigured,
  captureVisible: (tab) =>
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
  getSnapshot,
  openOptions: () => chrome.runtime.openOptionsPage(),
  createTab: (url) => chrome.tabs.create({ url }),
  dispatchCapture,
  submitTextReport,
  fetchImpl: fetch,
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type !== "string" || !message.type.startsWith("ARGUS_")) {
    return undefined;
  }

  handleMessage(message, sender).then(
    (result) => sendResponse(result),
    (error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );

  // Keep the message channel open for the async response.
  return true;
});
