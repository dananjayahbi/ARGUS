#!/usr/bin/env node
/**
 * Workflow A end-to-end gate:
 * CDN upload -> draft ingest -> token-gated canvas -> annotation upload ->
 * finalize -> pending issue on the board, plus bad-token and expired-token
 * negatives.
 *
 * It provisions a disposable PostgreSQL database and a temporary CDN storage
 * root, starts both real services, and tears everything down afterwards.
 *
 * Prerequisites: `npm run build` in apps/web and Python deps installed in
 * apps/cdn (or PYTHON_BIN set).
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

import { Client } from "pg";

const execFileAsync = promisify(execFile);
const appDir = process.cwd();
const repoRoot = path.resolve(appDir, "../..");
const cdnDir = path.resolve(repoRoot, "apps/cdn");
const envPath = path.join(appDir, ".env.local");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const WORKSPACE_TOKEN =
  process.env.WORKSPACE_TOKEN ??
  "e2e-workspace-token-0123456789abcdef0123456789";
const DRAFT_TOKEN_SECRET =
  process.env.DRAFT_TOKEN_SECRET ??
  "e2e-draft-token-secret-0123456789abcdef0123456789";
const CDN_AUTH_TOKEN =
  process.env.CDN_AUTH_TOKEN ??
  "e2e-cdn-token-0123456789abcdef0123456789abcdef";
const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  "e2e-session-secret-0123456789abcdef0123456789abcdef";
const QA_EMAIL = process.env.QA_EMAIL ?? "qa@argus.local";
const QA_PASSWORD = process.env.QA_PASSWORD ?? "qa123";
const DEVELOPER_EMAIL = process.env.DEVELOPER_EMAIL ?? "dev@argus.local";
const DEVELOPER_PASSWORD = process.env.DEVELOPER_PASSWORD ?? "dev123";

const logs = { web: "", cdn: "" };

function pythonBin() {
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

function freePort() {
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

async function waitFor(url, timeoutMs = 60000) {
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

function startService(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stdout.on("data", (chunk) => {
    logs[name] += chunk.toString();
    logs[name] = logs[name].slice(-16000);
  });
  child.stderr.on("data", (chunk) => {
    logs[name] += chunk.toString();
    logs[name] = logs[name].slice(-16000);
  });

  return child;
}

async function stopService(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(
      () => {},
    );
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signDraftToken(issueId, { now = new Date(), ttlSeconds = 1800 } = {}) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: issueId,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      scope: "canvas:draft",
    }),
  );
  const signature = createHmac("sha256", DRAFT_TOKEN_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
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

function makePng(width, height, pixel) {
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

function rawScreenshot() {
  return makePng(64, 64, (x, y) => {
    if (x > 16 && x < 48 && y > 16 && y < 48) {
      return [6, 182, 212, 255];
    }
    return [15, 23, 42, 255];
  });
}

function annotatedScreenshot() {
  return makePng(64, 64, (x, y) => {
    if (Math.abs(x - y) < 3) {
      return [244, 63, 94, 255];
    }
    if (x > 16 && x < 48 && y > 16 && y < 48) {
      return [6, 182, 212, 255];
    }
    return [15, 23, 42, 255];
  });
}

async function uploadAsset(baseUrl, token, category, bytes, filename) {
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

async function main() {
  if (!existsSync(path.join(appDir, ".next", "BUILD_ID"))) {
    throw new Error(
      "apps/web/.next/BUILD_ID is missing. Run `npm run build` first.",
    );
  }

  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const dbName = `argus_e2e_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const e2eUrl = new URL(sourceUrl);
  e2eUrl.pathname = `/${dbName}`;

  const storageRoot = await mkdtemp(path.join(tmpdir(), "argus-e2e-storage-"));
  const webPort = await freePort();
  const cdnPort = await freePort();
  const webBase = `http://127.0.0.1:${webPort}`;
  const cdnBase = `http://127.0.0.1:${cdnPort}`;

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  let web;
  let cdn;
  const summary = {};

  try {
    await execFileAsync(process.execPath, ["scripts/migrate.mjs", "up"], {
      cwd: appDir,
      env: { ...process.env, DATABASE_URL: e2eUrl.toString() },
      maxBuffer: 64 * 1024 * 1024,
    });

    const db = new Client({ connectionString: e2eUrl.toString() });
    await db.connect();
    const project = await db.query(
      "INSERT INTO projects (name, key) VALUES ('E2E Project', 'E2E') RETURNING id",
    );
    const projectId = project.rows[0].id;
    await db.end();

    cdn = startService(
      "cdn",
      pythonBin(),
      ["-m", "argus_cdn"],
      {
        cwd: cdnDir,
        env: {
          ...process.env,
          CDN_AUTH_TOKEN,
          CDN_BASE_URL: cdnBase,
          STORAGE_ROOT: storageRoot,
          HOST: "127.0.0.1",
          PORT: String(cdnPort),
          LOG_LEVEL: "INFO",
          SENTRY_DSN: "",
        },
      },
    );

    web = startService(
      "web",
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(webPort)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          DATABASE_URL: e2eUrl.toString(),
          WORKSPACE_TOKEN,
          DRAFT_TOKEN_SECRET,
          CDN_AUTH_TOKEN,
          CDN_BASE_URL: cdnBase,
          SESSION_SECRET,
          QA_EMAIL,
          QA_PASSWORD,
          DEVELOPER_EMAIL,
          DEVELOPER_PASSWORD,
          NODE_ENV: "production",
          SENTRY_DSN: "",
        },
      },
    );

    await waitFor(`${cdnBase}/healthz`);
    await waitFor(`${webBase}/api/healthz`);

    // 1. Real CDN upload with a valid token.
    const rawUpload = await uploadAsset(
      cdnBase,
      CDN_AUTH_TOKEN,
      "raw",
      rawScreenshot(),
      "workflow-a-raw.png",
    );
    assert.equal(rawUpload.response.status, 201);
    assert.match(rawUpload.body.url, /\/raw\//);

    // 2. Draft ingestion through the workspace-token boundary.
    const ingest = await fetch(`${webBase}/api/ingest/draft`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Workspace-Token": WORKSPACE_TOKEN,
      },
      body: JSON.stringify({
        project_id: projectId,
        report_type: "screenshot",
        raw_image_url: rawUpload.body.url,
        environment_info: {
          url: "https://target.example/e2e",
          viewport: { width: 1280, height: 720 },
        },
        console_logs: [
          {
            type: "error",
            message: "E2E console error",
            timestamp: "2026-11-06T00:00:00.000Z",
          },
        ],
      }),
    });
    assert.equal(ingest.status, 201);
    const draft = await ingest.json();
    const issueId = draft.issue_id;
    const draftToken = draft.draft_token;
    summary.issue_id = issueId;

    // 3. Negative: bad CDN token fails at the upload step and stores nothing.
    const badUpload = await uploadAsset(
      cdnBase,
      "definitely-wrong-token",
      "raw",
      rawScreenshot(),
      "workflow-a-bad.png",
    );
    assert.equal(badUpload.response.status, 401);
    assert.equal(badUpload.body.url, undefined);
    summary.bad_cdn_token_status = badUpload.response.status;

    // 4. Negative: an expired draft token cannot finalize the draft.
    const expiredToken = signDraftToken(issueId, {
      now: new Date(Date.now() - 3 * 60 * 60 * 1000),
      ttlSeconds: 60,
    });
    const expiredFinalize = await fetch(
      `${webBase}/api/issues/${issueId}/finalize?token=${encodeURIComponent(expiredToken)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Expired", priority: 50 }),
      },
    );
    assert.equal(expiredFinalize.status, 401);
    summary.expired_token_status = expiredFinalize.status;

    // 5. Open the real token-gated canvas page.
    const canvasPage = await fetch(draft.editor_url);
    const canvasHtml = await canvasPage.text();
    assert.equal(canvasPage.status, 200);
    assert.match(canvasHtml, /Bug configuration|ARGUS/);
    assert.doesNotMatch(canvasHtml, /Invalid draft link|Access token missing/);

    // 6. Upload the annotated PNG through the canvas upload proxy, then
    //    finalize with a vector scene containing one pen annotation.
    const annotated = annotatedScreenshot();
    const proxyForm = new FormData();
    proxyForm.append("category", "annotated");
    proxyForm.append(
      "file",
      new Blob([annotated], { type: "image/png" }),
      "workflow-a-annotated.png",
    );
    const proxyUpload = await fetch(
      `${webBase}/api/uploads?issueId=${issueId}&token=${encodeURIComponent(draftToken)}`,
      { method: "POST", body: proxyForm },
    );
    assert.equal(proxyUpload.status, 201);
    const annotatedUpload = await proxyUpload.json();
    assert.match(annotatedUpload.url, /\/annotated\//);

    const canvasState = {
      version: 1,
      width: 64,
      height: 64,
      background: rawUpload.body.url,
      nodes: [
        {
          id: "e2e-pen-1",
          type: "pen",
          x: 0,
          y: 0,
          points: [4, 4, 20, 20, 40, 40, 60, 60],
          stroke: "#f43f5e",
          strokeWidth: 4,
        },
      ],
    };

    const finalize = await fetch(
      `${webBase}/api/issues/${issueId}/finalize?token=${encodeURIComponent(draftToken)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Workflow A: annotated checkout bug",
          description: "Captured by the automated end-to-end gate.",
          priority: 82,
          annotated_image_url: annotatedUpload.url,
          canvas_state: canvasState,
        }),
      },
    );
    assert.equal(finalize.status, 200);
    const finalized = await finalize.json();
    assert.equal(finalized.status, "pending");
    summary.finalize_status = finalize.status;

    // 7. Assert the persisted row has both outputs.
    const check = new Client({ connectionString: e2eUrl.toString() });
    await check.connect();
    const row = await check.query(
      `SELECT status,
              annotated_image_url,
              canvas_state,
              raw_image_url
         FROM issues
        WHERE id = $1`,
      [issueId],
    );
    await check.end();
    const issue = row.rows[0];
    assert.equal(issue.status, "pending");
    assert.ok(issue.annotated_image_url, "annotated_image_url must be set");
    assert.ok(issue.raw_image_url, "raw_image_url must be set");
    assert.equal(issue.canvas_state.version, 1);
    assert.equal(issue.canvas_state.nodes.length, 1);
    assert.equal(issue.canvas_state.nodes[0].type, "pen");
    summary.annotated_image_url = issue.annotated_image_url;
    summary.canvas_nodes = issue.canvas_state.nodes.length;

    // 8. The board must show the issue for an authenticated dashboard user.
    const login = await fetch(`${webBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.match(/argus_session=[^;]+/)?.[0];
    assert.ok(cookie, "login must set the session cookie");

    const board = await fetch(`${webBase}/projects/E2E`, {
      headers: { cookie },
    });
    const boardHtml = await board.text();
    assert.equal(board.status, 200);
    assert.match(boardHtml, /Workflow A: annotated checkout bug/);
    assert.match(boardHtml, /E2E-|issue/);
    summary.board_visible = true;

    console.log(JSON.stringify({ status: "ok", ...summary }, null, 2));
  } catch (error) {
    console.error("E2E Workflow A failed");
    console.error(error);
    console.error("--- web log tail ---");
    console.error(logs.web.slice(-4000));
    console.error("--- cdn log tail ---");
    console.error(logs.cdn.slice(-4000));
    process.exitCode = 1;
  } finally {
    await stopService(web);
    await stopService(cdn);

    const cleanupAdmin = new Client({ connectionString: adminUrl.toString() });
    await cleanupAdmin.connect().catch(() => {});
    await cleanupAdmin
      .query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [dbName],
      )
      .catch(() => {});
    await cleanupAdmin.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
    await cleanupAdmin.end().catch(() => {});

    await rm(storageRoot, { recursive: true, force: true });
  }
}

await main();
