import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticRoot = path.join(appRoot, ".next", "static");
const publicRoot = path.join(appRoot, "public");

function parseEnvFile(file) {
  if (!existsSync(file)) {
    return {};
  }

  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function walk(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function isSecretName(name) {
  return (
    name === "DATABASE_URL" ||
    /(_TOKEN|_SECRET|_PASSWORD|_KEY)$/.test(name)
  );
}

function secretCandidates(name, value) {
  const candidates = new Set([value]);

  if (name === "DATABASE_URL") {
    try {
      const url = new URL(value);
      if (url.password) {
        candidates.add(url.password);
        candidates.add(decodeURIComponent(url.password));
      }
    } catch {
      // The startup env validator reports malformed URLs separately.
    }
  }

  return [...candidates].filter((candidate) => candidate.length >= 8);
}

if (!existsSync(staticRoot)) {
  console.error(
    "check:client-secrets requires a production build first (missing .next/static).",
  );
  process.exit(1);
}

const fileEnv = {
  ...parseEnvFile(path.join(appRoot, ".env")),
  ...parseEnvFile(path.join(appRoot, ".env.local")),
};

const secrets = [];
for (const [name, value] of Object.entries(process.env)) {
  if (isSecretName(name) && typeof value === "string") {
    secrets.push([name, value]);
  }
}
for (const [name, value] of Object.entries(fileEnv)) {
  if (isSecretName(name) && typeof value === "string") {
    if (!secrets.some(([existing]) => existing === name)) {
      secrets.push([name, value]);
    }
  }
}

const outputFiles = [...walk(staticRoot), ...walk(publicRoot)].filter((file) =>
  statSync(file).isFile(),
);

const findings = [];
for (const file of outputFiles) {
  const contents = readFileSync(file, "latin1");
  for (const [name, value] of secrets) {
    for (const candidate of secretCandidates(name, value)) {
      if (contents.includes(candidate)) {
        findings.push({ file, name });
        break;
      }
    }
  }
}

if (findings.length > 0) {
  console.error(
    "Server secret values were found in client-facing output. Remove them from client components and NEXT_PUBLIC_ variables.",
  );
  for (const finding of findings) {
    console.error(
      `  - ${finding.name} appears in ${path.relative(appRoot, finding.file)}`,
    );
  }
  process.exit(1);
}

console.log(
  `Client secret scan passed (${outputFiles.length} files, ${secrets.length} secret variables).`,
);
