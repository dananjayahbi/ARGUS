const PANEL_BEHAVIOR = { openPanelOnActionClick: true };

function enablePanelBehavior() {
  chrome.sidePanel.setPanelBehavior(PANEL_BEHAVIOR).catch(() => {
    // Older Chromium builds may not support the behavior flag; the action
    // click handler below still opens the panel.
  });
}

chrome.runtime.onInstalled.addListener(enablePanelBehavior);
chrome.runtime.onStartup.addListener(enablePanelBehavior);

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId === undefined) {
    return;
  }

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    // setPanelBehavior already opens the panel on supported versions.
  }
});
