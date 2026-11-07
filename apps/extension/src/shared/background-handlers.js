/**
 * Message handlers used by the extension service worker.
 *
 * The handlers are created with their dependencies injected so the wiring can
 * be unit tested in Node without a Chrome runtime. The service worker passes
 * the real `chrome.*` calls; tests pass fakes.
 */

function configError() {
  return {
    ok: false,
    error:
      "Open the extension Settings and enter the app URL, CDN URL, workspace token, CDN token and project ID.",
  };
}

function fallbackEnvironment(message) {
  const environment = message?.environment;
  if (environment && typeof environment === "object") {
    return environment;
  }

  return {
    url: "",
    title: "",
    viewport: { width: 0, height: 0 },
    screen: { width: 0, height: 0 },
    device_pixel_ratio: 1,
    user_agent: "",
    os: "Unknown",
  };
}

export function createMessageHandler({
  loadSettings,
  isConfigured,
  captureVisible,
  getSnapshot,
  openOptions,
  createTab,
  dispatchCapture,
  submitTextReport,
  fetchImpl = fetch,
}) {
  return async function handleMessage(message, sender) {
    switch (message?.type) {
      case "ARGUS_CAPTURE_VISIBLE": {
        if (!sender?.tab) {
          return { ok: false, error: "No active tab to capture." };
        }
        const dataUrl = await captureVisible(sender.tab);
        return { ok: true, dataUrl };
      }

      case "ARGUS_GET_SNAPSHOT": {
        if (!sender?.tab?.id) {
          return { ok: false, error: "No active tab to harvest." };
        }
        const snapshot = await getSnapshot(sender.tab.id);
        if (!snapshot) {
          return {
            ok: false,
            error: "The page did not return a harvest snapshot.",
          };
        }
        return { ok: true, snapshot };
      }

      case "ARGUS_OPEN_OPTIONS": {
        await openOptions();
        return { ok: true };
      }

      case "ARGUS_DISPATCH": {
        const settings = await loadSettings();
        if (!isConfigured(settings)) {
          return { ...configError(), step: 0 };
        }

        return dispatchCapture({
          capture: message.capture,
          settings,
          fetchImpl,
          createTab,
          readSnapshot: (tabId) => getSnapshot(tabId),
        });
      }

      case "ARGUS_TEXT_REPORT": {
        const settings = await loadSettings();
        if (!isConfigured(settings)) {
          return configError();
        }

        const snapshot = sender?.tab?.id
          ? await getSnapshot(sender.tab.id).catch(() => null)
          : null;
        const environment =
          snapshot?.environment_info ?? fallbackEnvironment(message);
        const logs = Array.isArray(snapshot?.console_logs)
          ? snapshot.console_logs
          : [];

        return submitTextReport({
          projectId: message.projectId || settings.projectId,
          title: message.title,
          description: message.description,
          priority: message.priority,
          environment,
          logs,
          settings,
          fetchImpl,
        });
      }

      default:
        return {
          ok: false,
          error: `Unknown ARGUS extension message: ${message?.type ?? "none"}`,
        };
    }
  };
}
