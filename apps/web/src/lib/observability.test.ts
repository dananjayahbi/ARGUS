import { afterEach, describe, expect, it, vi } from "vitest";

import { withApiObservability } from "./observability";

afterEach(() => {
  vi.restoreAllMocks();
});

function lastJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = spy.mock.calls;
  const raw = calls[calls.length - 1]?.[0];
  return JSON.parse(String(raw));
}

describe("withApiObservability", () => {
  it("adds an x-request-id header and logs one JSON request line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = withApiObservability("GET /api/test", async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const response = await handler(
      new Request("http://localhost/api/test", {
        headers: { "x-request-id": "req-abc" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-abc");

    const line = lastJson(logSpy);
    expect(line).toMatchObject({
      service: "web",
      event: "request",
      request_id: "req-abc",
      method: "GET",
      path: "/api/test",
      status: 200,
    });
    expect(typeof line.duration_ms).toBe("number");
  });

  it("generates a request id when the caller did not supply one", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = withApiObservability("GET /api/test", async () =>
      new Response(null, { status: 204 }),
    );

    const response = await handler(new Request("http://localhost/api/test"));

    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("returns a correlated 500 and logs the failure without the message", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiObservability("POST /api/test", async () => {
      throw new Error("token=super-secret");
    });

    const response = await handler(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "x-request-id": "req-fail" },
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req-fail");
    const body = await response.json();
    expect(body.error.request_id).toBe("req-fail");

    const line = lastJson(errorSpy);
    expect(line).toMatchObject({
      event: "request_failed",
      request_id: "req-fail",
      error_name: "Error",
    });
    expect(JSON.stringify(line)).not.toContain("super-secret");
  });
});
