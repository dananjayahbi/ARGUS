import assert from "node:assert/strict";

import { createMessageHandler } from "./src/shared/background-handlers.js";

const settings = {
  appBaseUrl: "http://app.test",
  cdnBaseUrl: "http://cdn.test",
  workspaceToken: "workspace-secret",
  cdnToken: "cdn-secret",
  projectId: "11111111-1111-4111-8111-111111111111",
};

const sender = { tab: { id: 7, windowId: 3 } };

function makeHandler(overrides = {}) {
  const calls = {
    captureVisible: [],
    getSnapshot: [],
    openOptions: 0,
    createTab: [],
    dispatch: [],
    textReport: [],
  };

  const handler = createMessageHandler({
    loadSettings: async () => settings,
    isConfigured: (value) =>
      Boolean(value?.workspaceToken && value?.cdnToken && value?.projectId),
    captureVisible: async (tab) => {
      calls.captureVisible.push(tab);
      return "data:image/png;base64,AAAA";
    },
    getSnapshot: async (tabId) => {
      calls.getSnapshot.push(tabId);
      return {
        environment_info: { url: "https://example.com", title: "Example" },
        console_logs: [{ type: "error", message: "boom" }],
      };
    },
    openOptions: async () => {
      calls.openOptions += 1;
    },
    createTab: async (url) => {
      calls.createTab.push(url);
    },
    dispatchCapture: async (input) => {
      calls.dispatch.push(input);
      return { ok: true, step: 2, editorUrl: "http://app.test/canvas/x" };
    },
    submitTextReport: async (input) => {
      calls.textReport.push(input);
      return {
        ok: true,
        issueId: "issue",
        redirectUrl: "http://app.test/projects/ARG?issue=issue",
      };
    },
    fetchImpl: async () => {
      throw new Error("fetch should be provided by dispatch/text-report fakes");
    },
    ...overrides,
  });

  return { handler, calls };
}

async function testCaptureVisible() {
  const { handler, calls } = makeHandler();
  const result = await handler({ type: "ARGUS_CAPTURE_VISIBLE" }, sender);
  assert.deepEqual(result, {
    ok: true,
    dataUrl: "data:image/png;base64,AAAA",
  });
  assert.deepEqual(calls.captureVisible, [sender.tab]);
}

async function testOpenOptions() {
  const { handler, calls } = makeHandler();
  const result = await handler({ type: "ARGUS_OPEN_OPTIONS" }, sender);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.openOptions, 1);
}

async function testSnapshot() {
  const { handler, calls } = makeHandler();
  const result = await handler({ type: "ARGUS_GET_SNAPSHOT" }, sender);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.environment_info.url, "https://example.com");
  assert.deepEqual(calls.getSnapshot, [7]);

  const empty = makeHandler({ getSnapshot: async () => null });
  const missing = await empty.handler({ type: "ARGUS_GET_SNAPSHOT" }, sender);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /did not return/);
}

async function testDispatch() {
  const { handler, calls } = makeHandler();
  const capture = { dataUrl: "data:image/png;base64,AAAA" };
  const result = await handler({ type: "ARGUS_DISPATCH", capture }, sender);
  assert.equal(result.ok, true);
  assert.equal(calls.dispatch.length, 1);
  assert.equal(calls.dispatch[0].capture, capture);
  assert.deepEqual(calls.dispatch[0].settings, settings);
  assert.equal(typeof calls.dispatch[0].createTab, "function");
  assert.equal(typeof calls.dispatch[0].fetchImpl, "function");
}

async function testDispatchUnconfigured() {
  const { handler, calls } = makeHandler({
    isConfigured: () => false,
  });
  const result = await handler(
    { type: "ARGUS_DISPATCH", capture: {} },
    sender,
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Settings/);
  assert.equal(calls.dispatch.length, 0);
}

async function testTextReportUsesSnapshot() {
  const { handler, calls } = makeHandler();
  const result = await handler(
    {
      type: "ARGUS_TEXT_REPORT",
      title: "Broken",
      description: "Details",
      priority: 40,
    },
    sender,
  );
  assert.equal(result.ok, true);
  assert.match(result.redirectUrl, /projects\/ARG/);
  assert.equal(calls.textReport.length, 1);
  assert.equal(calls.textReport[0].title, "Broken");
  assert.equal(calls.textReport[0].priority, 40);
  assert.equal(calls.textReport[0].projectId, settings.projectId);
  assert.equal(
    calls.textReport[0].environment.url,
    "https://example.com",
  );
  assert.equal(calls.textReport[0].logs.length, 1);
}

async function testTextReportFallsBackToEnvironment() {
  const { handler, calls } = makeHandler({ getSnapshot: async () => null });
  const fallback = { url: "https://fallback.test", title: "Fallback" };
  const result = await handler(
    {
      type: "ARGUS_TEXT_REPORT",
      title: "Broken",
      priority: 40,
      environment: fallback,
    },
    sender,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls.textReport[0].environment, fallback);
  assert.deepEqual(calls.textReport[0].logs, []);
}

async function testUnknown() {
  const { handler } = makeHandler();
  const result = await handler({ type: "ARGUS_NOPE" }, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown/);
}

await testCaptureVisible();
await testOpenOptions();
await testSnapshot();
await testDispatch();
await testDispatchUnconfigured();
await testTextReportUsesSnapshot();
await testTextReportFallsBackToEnvironment();
await testUnknown();
console.log("Background message handler tests passed.");
