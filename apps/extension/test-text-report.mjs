import assert from "node:assert/strict";

import { submitTextReport } from "./src/shared/text-report.js";

const settings = {
  appBaseUrl: "http://app.test",
  workspaceToken: "workspace-secret",
};

const environment = { url: "https://example.com", title: "Example" };
const logs = [
  {
    type: "error",
    message: "boom",
    timestamp: "2026-01-01T00:00:00.000Z",
  },
];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function testSuccess() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });

    if (String(url).endsWith("/api/ingest/draft")) {
      return jsonResponse(
        {
          issue_id: "issue",
          draft_token: "token",
          editor_url: "http://app.test/canvas/issue?token=token",
        },
        201,
      );
    }

    if (String(url).includes("/api/issues/issue/finalize")) {
      return jsonResponse(
        { success: true, status: "pending", redirect_url: "/projects/ARG" },
        200,
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await submitTextReport({
    projectId: "project",
    title: "Text bug",
    description: "Details",
    priority: 60,
    environment,
    logs,
    settings,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.redirectUrl, "http://app.test/projects/ARG?issue=issue");
  assert.equal(calls.length, 2);
  assert.equal(
    calls.some((call) => call.url.includes("/api/upload")),
    false,
  );

  const ingestPayload = JSON.parse(calls[0].init.body);
  assert.equal(ingestPayload.report_type, "text_only");
  assert.equal("raw_image_url" in ingestPayload, false);
  assert.deepEqual(ingestPayload.environment_info, environment);
  assert.equal(ingestPayload.console_logs.length, 1);

  assert.match(calls[1].url, /\/api\/issues\/issue\/finalize\?token=token/);
  const finalizePayload = JSON.parse(calls[1].init.body);
  assert.equal(finalizePayload.title, "Text bug");
  assert.equal(finalizePayload.description, "Details");
  assert.equal(finalizePayload.priority, 60);
}

async function testValidation() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    throw new Error("should not be called");
  };

  const noTitle = await submitTextReport({
    projectId: "project",
    title: "   ",
    description: "",
    priority: 50,
    environment,
    logs,
    settings,
    fetchImpl,
  });
  assert.equal(noTitle.ok, false);
  assert.match(noTitle.error, /title is required/i);

  const badPriority = await submitTextReport({
    projectId: "project",
    title: "Valid",
    description: "",
    priority: 101,
    environment,
    logs,
    settings,
    fetchImpl,
  });
  assert.equal(badPriority.ok, false);
  assert.match(badPriority.error, /0 to 100/);
  assert.equal(calls.length, 0);
}

await testSuccess();
await testValidation();
console.log("Text-only report tests passed.");
