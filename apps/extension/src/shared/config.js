export const STORAGE_KEY = "argus.settings.v1";

export const DEFAULT_SETTINGS = Object.freeze({
  appBaseUrl: "http://localhost:3000",
  cdnBaseUrl: "http://127.0.0.1:8080",
  workspaceToken: "",
  cdnToken: "",
  projectId: "",
});

export async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] ?? {}) };
}

export async function saveSettings(settings) {
  const normalized = {
    appBaseUrl: String(settings.appBaseUrl ?? "")
      .trim()
      .replace(/\/+$/, ""),
    cdnBaseUrl: String(settings.cdnBaseUrl ?? "")
      .trim()
      .replace(/\/+$/, ""),
    workspaceToken: String(settings.workspaceToken ?? "").trim(),
    cdnToken: String(settings.cdnToken ?? "").trim(),
    projectId: String(settings.projectId ?? "").trim(),
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export function isConfigured(settings) {
  return Boolean(
    settings.appBaseUrl &&
      settings.cdnBaseUrl &&
      settings.workspaceToken &&
      settings.cdnToken &&
      settings.projectId,
  );
}
