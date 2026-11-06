import assert from "node:assert/strict";

import { dispatchCapture } from "./src/shared/dispatch.js";

const capture = {
  dataUrl: "data:image/png;base64,AAAA",
  mode: "area",
  viewport: { width: 100, height: 100 },
  devicePixelRatio: 1,
  pageUrl: "https://example.com",
  snapshot: {
    environment_info: { url: "https://example.com", title: "Example" },
    console_logs: [
      {
        type: "error",
        message: "boom",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
};

const settings = {
  cdnBaseUrl: "http://cdn.test",
  appBaseUrl: "http://app.test",
  cdnToken: "cdn-secret",
  workspaceToken: "workspace-secret",
  projectId: "11111111-1111-4111-8111-111111111111",
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });

    if (String(url) === capture.dataUrl) {
      return { blob: async () => new Blob(["png"], { type: "image/png" }) };
    }
    if (String(url).endsWith("/api/upload")) {
      return (
        overrides.upload ??
        jsonResponse(
          {
            success: true,
            url: "http://cdn.test/raw/x.png",
            file_size_bytes: 3,
          },
          201,
        )
      );
    }
    if (String(url).endsWith("/api/ingest/draft")) {
      return (
        overrides.ingest ??
        jsonResponse(
          {
            issue_id: "issue",
            draft_token: "token",
            editor_url: "http://app.test/canvas/issue?token=token",
          },
          201,
        )
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  return { fetchImpl, calls };
}

async function testSuccess() {
  const { fetchImpl, calls } = makeFetch();
  const created = [];
  const steps = [];

  const result = await dispatchCapture({
    capture,
    settings,
    fetchImpl,
    createTab: async (url) => created.push(url),
    onStep: (step) => steps.push(step),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(created, ["http://app.test/canvas/issue?token=token"]);
  assert.deepEqual(steps, [0, 1, 2]);

  const uploadCall = calls.find((call) => call.url.endsWith("/api/upload"));
  assert.equal(uploadCall.init.headers["X-CDN-Auth-Token"], "cdn-secret");

  const ingestCall = calls.find((call) =>
    call.url.endsWith("/api/ingest/draft"),
  );
  assert.equal(
    ingestCall.init.headers["X-Workspace-Token"],
    "workspace-secret",
  );

  const payload = JSON.parse(ingestCall.init.body);
  assert.equal(payload.project_id, settings.projectId);
  assert.equal(payload.report_type, "screenshot");
  assert.equal(payload.raw_image_url, "http://cdn.test/raw/x.png");
  assert.equal(payload.environment_info.url, "https://example.com");
  assert.equal(payload.console_logs.length, 1);
}

async function testCdnFailure() {
  const { fetchImpl, calls } = makeFetch({
    upload: jsonResponse(
      { detail: "Uploaded file exceeds the image limit" },
      413,
    ),
  });
  const created = [];

  const result = await dispatchCapture({
    capture,
    settings,
    fetchImpl,
    createTab: async (url) => created.push(url),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /No draft was created/);
  assert.equal(
    calls.some((call) => call.url.endsWith("/api/ingest/draft")),
    false,
  );
  assert.deepEqual(created, []);
}

async function testIngestFailure() {
  const { fetchImpl, calls } = makeFetch({
    ingest: jsonResponse({ error: { message: "Project not found." } }, 404),
  });
  const created = [];

  const result = await dispatchCapture({
    capture,
    settings,
    fetchImpl,
    createTab: async (url) => created.push(url),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /orphaned/);
  assert.match(result.error, /http:\/\/cdn\.test\/raw\/x\.png/);
  assert.deepEqual(created, []);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/api/upload")).length,
    1,
  );
}

await testSuccess();
await testCdnFailure();
await testIngestFailure();
console.log("Dispatch flow tests passed.");
