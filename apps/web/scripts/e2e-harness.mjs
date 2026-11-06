#!/usr/bin/env node
/** Shared harness for the ARGUS end-to-end workflow gates. */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

import { Client } from "pg";

const execFileAsync = promisify(execFile);
export const appDir = process.cwd();
export const repoRoot = path.resolve(appDir, "../..");
export const cdnDir = path.resolve(repoRoot, "apps/cdn");

if (existsSync(path.join(appDir, ".env.local"))) {
  process.loadEnvFile(path.join(appDir, ".env.local"));
}

export function e2eConfig() {
  return {
    workspaceToken:
      process.env.WORKSPACE_TOKEN ??
      "e2e-workspace-token-0123456789abcdef0123456789",
    draftTokenSecret:
      process.env.DRAFT_TOKEN_SECRET ??
      "e2e-draft-token-secret-0123456789abcdef0123456789",
    cdnAuthToken:
      process.env.CDN_AUTH_TOKEN ??
      "e2e-cdn-token-0123456789abcdef0123456789abcdef",
    sessionSecret:
      process.env.SESSION_SECRET ??
      "e2e-session-secret-0123456789abcdef0123456789abcdef",
    qaEmail: process.env.QA_EMAIL ?? "qa@argus.local",
    qaPassword: process.env.QA_PASSWORD ?? "qa-dev-password",
    developerEmail: process.env.DEVELOPER_EMAIL ?? "dev@argus.local",
    developerPassword: process.env.DEVELOPER_PASSWORD ?? "dev-dev-password",
  };
}

export function assertWebBuild() {
  if (!existsSync(path.join(appDir, ".next", "BUILD_ID"))) {
    throw new Error(
      "apps/web/.next/BUILD_ID is missing. Run `npm run build` first.",
    );
  }
}

export function pythonBin() {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }
  const venv =
    process.platform === "win32"
      ? path.join(cdnDir, ".venv", "Scripts", "python.exe")
      : path.join(cdnDir, ".venv", "bin", "python");
  if (existsSync(venv)) {
    return venv;
  }
  return process.platform === "win32" ? "python" : "python3";
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function waitFor(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

export function startService(name, command, args, options, logs) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const append = (chunk) => {
    logs[name] = `${logs[name]}${chunk.toString()}`.slice(-16000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  return child;
}

export async function stopService(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("taskkill", [
      "/pid",
      String(child.pid),
      "/T",
      "/F",
    ]).catch(() => {});
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function makePng(width, height, pixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * stride + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function provisionDatabase(sourceUrl, prefix) {
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const dbName = `${prefix}_${Date.now()}`;
  const databaseUrl = new URL(sourceUrl);
  databaseUrl.pathname = `/${dbName}`;

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  await execFileAsync(process.execPath, ["scripts/migrate.mjs", "up"], {
    cwd: appDir,
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    maxBuffer: 64 * 1024 * 1024,
  });

  return {
    dbName,
    databaseUrl: databaseUrl.toString(),
    adminUrl: adminUrl.toString(),
  };
}

export async function dropDatabase(adminUrl, dbName) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect().catch(() => {});
  await admin
    .query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [dbName],
    )
    .catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
  await admin.end().catch(() => {});
}

export async function startAppServices({ databaseUrl, config, logs }) {
  const storageRoot = await mkdtemp(
    path.join(tmpdir(), "argus-e2e-storage-"),
  );
  const webPort = await freePort();
  const cdnPort = await freePort();
  const webBase = `http://127.0.0.1:${webPort}`;
  const cdnBase = `http://127.0.0.1:${cdnPort}`;

  const cdn = startService(
    "cdn",
    pythonBin(),
    ["-m", "argus_cdn"],
    {
      cwd: cdnDir,
      env: {
        ...process.env,
        CDN_AUTH_TOKEN: config.cdnAuthToken,
        CDN_BASE_URL: cdnBase,
        STORAGE_ROOT: storageRoot,
        HOST: "127.0.0.1",
        PORT: String(cdnPort),
        LOG_LEVEL: "INFO",
        SENTRY_DSN: "",
      },
    },
    logs,
  );

  const web = startService(
    "web",
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(webPort)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        WORKSPACE_TOKEN: config.workspaceToken,
        DRAFT_TOKEN_SECRET: config.draftTokenSecret,
        CDN_AUTH_TOKEN: config.cdnAuthToken,
        CDN_BASE_URL: cdnBase,
        SESSION_SECRET: config.sessionSecret,
        QA_EMAIL: config.qaEmail,
        QA_PASSWORD: config.qaPassword,
        DEVELOPER_EMAIL: config.developerEmail,
        DEVELOPER_PASSWORD: config.developerPassword,
        NODE_ENV: "production",
        SENTRY_DSN: "",
      },
    },
    logs,
  );

  await waitFor(`${cdnBase}/healthz`);
  await waitFor(`${webBase}/api/healthz`);

  return { cdn, web, storageRoot, webBase, cdnBase };
}

export async function uploadAsset(
  baseUrl,
  token,
  category,
  bytes,
  filename,
) {
  const form = new FormData();
  form.append("category", category);
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);

  const response = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { "X-CDN-Auth-Token": token },
    body: form,
  });
  return { response, body: await response.json().catch(() => ({})) };
}

export async function login(webBase, email, password) {
  const response = await fetch(`${webBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.match(/argus_session=[^;]+/)?.[0] ?? null;
  return { response, cookie };
}

export async function cleanupStorage(storageRoot) {
  await rm(storageRoot, { recursive: true, force: true });
}
