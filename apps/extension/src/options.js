import { loadSettings, saveSettings } from "./shared/config.js";

const form = document.querySelector("#settings-form");
const status = document.querySelector("#status");
const fields = [
  "appBaseUrl",
  "cdnBaseUrl",
  "workspaceToken",
  "cdnToken",
  "projectId",
];

function field(name) {
  return document.querySelector(`#${name}`);
}

function fill(settings) {
  for (const name of fields) {
    field(name).value = settings[name] ?? "";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const settings = {};
  for (const name of fields) {
    settings[name] = field(name).value;
  }

  try {
    await saveSettings(settings);
    status.textContent = "Settings saved.";
    status.className = "status ok";
  } catch {
    status.textContent = "Unable to save settings.";
    status.className = "status error";
  }
});

loadSettings()
  .then(fill)
  .catch(() => {
    status.textContent = "Unable to load settings.";
    status.className = "status error";
  });
