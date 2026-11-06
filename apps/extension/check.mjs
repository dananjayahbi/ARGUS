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

for (const permission of ["sidePanel", "activeTab", "scripting", "storage"]) {
  if (!manifest.permissions?.includes(permission)) {
    errors.push(`missing permission: ${permission}`);
  }
}

for (const file of [
  "background.js",
  "sidepanel.html",
  "sidepanel.js",
  "options.html",
  "options.js",
  "shared/config.js",
  "shared/capture.js",
  "shared/dispatch.js",
  "shared/text-report.js",
  "content/harvester.js",
  "content/snip-overlay.js",
  "content/fullpage.js",
]) {
  if (!existsSync(path.join(source, file))) {
    errors.push(`missing file: ${file}`);
  }
}

if (manifest.side_panel?.default_path !== "sidepanel.html") {
  errors.push("side_panel.default_path must be sidepanel.html");
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

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Extension manifest and source checks passed.");
