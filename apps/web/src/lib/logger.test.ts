import { afterEach, describe, expect, it, vi } from "vitest";

import { logEvent, logRequest, redact } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("structured logger", () => {
  it("emits one JSON line with timestamp, level, service and event", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logEvent("info", "startup", { request_id: "req-1" });

    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.level).toBe("info");
    expect(line.service).toBe("web");
    expect(line.event).toBe("startup");
    expect(line.request_id).toBe("req-1");
    expect(typeof line.timestamp).toBe("string");
  });

  it("redacts sensitive keys and bearer tokens", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logEvent("info", "test", {
      request_id: "req-2",
      workspace_token: "workspace-secret",
      nested: { note: "private note", safe: 1 },
      header: "Bearer abc.def.ghi",
    });

    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.workspace_token).toBe("[REDACTED]");
    expect(line.nested.note).toBe("[REDACTED]");
    expect(line.nested.safe).toBe(1);
    expect(line.header).toBe("[REDACTED]");
  });

  it("keeps the request log shape shared with the CDN", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logRequest({
      request_id: "req-3",
      method: "GET",
      path: "/api/healthz",
      status: 200,
      duration_ms: 12,
    });

    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      service: "web",
      event: "request",
      request_id: "req-3",
      method: "GET",
      path: "/api/healthz",
      status: 200,
      duration_ms: 12,
    });
  });

  it("redacts recursively with a depth limit", () => {
    const value = { a: { b: { c: { d: { e: { f: "deep" } } } } } };

    expect(redact(value)).toEqual({
      a: { b: { c: { d: { e: "[TRUNCATED]" } } } },
    });
  });
});
