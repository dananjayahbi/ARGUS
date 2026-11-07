import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "src");
const errors = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

let manifest;
try {
  manifest = JSON.parse(
    readFileSync(path.join(source, "manifest.json"), "utf8"),
  );
} catch (error) {
  console.error("Unable to parse manifest.json:", error.message);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  errors.push("manifest_version must be 3");
}

for (const permission of ["activeTab", "scripting", "storage"]) {
  if (!manifest.permissions?.includes(permission)) {
    errors.push(`missing permission: ${permission}`);
  }
}

if (!manifest.host_permissions?.includes("<all_urls>")) {
  errors.push("host_permissions must include <all_urls>");
}

if (!manifest.content_scripts?.some((cs) => cs.js?.includes("content/overlay.js"))) {
  errors.push("content_scripts must inject content/overlay.js on all pages");
}

if (
  !manifest.content_scripts?.some((cs) =>
    cs.css?.includes("content/overlay.css"),
  )
) {
  errors.push(
    "content_scripts must inject content/overlay.css so the overlay survives page CSP",
  );
}

for (const file of [
  "background.js",
  "options.html",
  "options.js",
  "shared/config.js",
  "shared/background-handlers.js",
  "shared/capture.js",
  "shared/dispatch.js",
  "shared/text-report.js",
  "content/harvester.js",
  "content/snip-overlay.js",
  "content/fullpage.js",
  "content/overlay.css",
  "content/overlay.js",
]) {
  if (!existsSync(path.join(source, file))) {
    errors.push(`missing file: ${file}`);
  }
}

if (manifest.side_panel?.default_path === "sidepanel.html") {
  errors.push("side_panel must be removed for the overlay approach");
}

if (manifest.background?.service_worker !== "background.js") {
  errors.push("background.service_worker must be background.js");
}

if (!manifest.action) {
  errors.push("action is required");
}

for (const file of walk(source).filter((entry) => entry.endsWith(".js"))) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    errors.push(
      `syntax error in ${path.relative(source, file)}: ${error.message}`,
    );
  }
}

const config = readFileSync(path.join(source, "shared", "config.js"), "utf8");
if (
  /workspaceToken:\s*"[^"]+"/.test(config) ||
  /cdnToken:\s*"[^"]+"/.test(config)
) {
  errors.push("shared/config.js must not contain a non-empty default token");
}

const overlay = readFileSync(path.join(source, "content", "overlay.js"), "utf8");
if (overlay.includes('createElement("style")')) {
  errors.push(
    "content/overlay.js must not inject a <style> element; use the declared CSS file so page CSP cannot hide the overlay",
  );
}

for (const marker of [
  'id="argus-add"',
  'id="argus-add-more"',
  'id="argus-staged-list"',
  'id="argus-create-staged"',
  'type: "ARGUS_DISPATCH"',
  "captures,",
]) {
  if (!overlay.includes(marker)) {
    errors.push(
      `content/overlay.js is missing multi-screenshot marker: ${marker}`,
    );
  }
}

// Bug #1: after the extension is reloaded/updated, chromium tears down the
// extension APIs in content scripts that are already in a page. `chrome.runtime`
// becomes undefined and any direct access crashes with
// "Cannot read properties of undefined (reading 'onMessage')".
for (const forbidden of [
  "chrome.runtime.onMessage.addListener",
  "chrome.runtime.sendMessage",
  "chrome.storage.local.get",
  "chrome.storage.session.get",
  "chrome.storage.session.set",
]) {
  if (overlay.includes(forbidden)) {
    errors.push(
      `content/overlay.js must guard extension APIs before use; found direct call ${forbidden}`,
    );
  }
}

for (const guard of ["CONTEXT_LOST_MESSAGE", "function isExtensionAlive()"]) {
  if (!overlay.includes(guard)) {
    errors.push(
      `content/overlay.js is missing the extension-context guard: ${guard}`,
    );
  }
}

if (
  !/function applyButtonState\(\)[\s\S]{0,400}updateCaptureButtons\(\)/.test(
    overlay,
  )
) {
  errors.push(
    "content/overlay.js applyButtonState must call updateCaptureButtons so capture actions are re-enabled after a capture",
  );
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Extension manifest and source checks passed.");
