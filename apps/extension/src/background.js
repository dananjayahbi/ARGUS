// ARGUS overlay controller (runs in the service worker).
// A floating icon is injected on every http(s) page; clicking it opens the
// compact capture popup over the page. No side panel is opened.

function isCapturableUrl(url) {
  if (!url) return false;
  try {
    const scheme = new URL(url).protocol.replace(":", "");
    return scheme === "http" || scheme === "https";
  } catch {
    return false;
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
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/overlay.js"],
    });
  } catch {
    // Injected overlay handles its own errors; nothing to do here.
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ARGUS_CAPTURE_REQUEST") {
    chrome.runtime.sendMessage(message);
  }
});
