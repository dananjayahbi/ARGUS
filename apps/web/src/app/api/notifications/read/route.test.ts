import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { getRequestSession } from "@/lib/session";

import { POST } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ getRequestSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(getRequestSession);

const USER_ID = "44444444-4444-4444-8444-444444444444";
const NOTIFICATION_ID = "77777777-7777-4777-8777-777777777777";

const session = {
  sessionId: "session-1",
  user: { id: USER_ID, email: "qa@example.com", role: "qa" as const },
};

function request(body: unknown) {
  return new Request("http://localhost:3000/api/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/notifications/read", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(null);

    const response = await POST(request({ all: true }));

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a payload with neither ids nor all", async () => {
    sessionMock.mockResolvedValue(session);

    const response = await POST(request({}));

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("marks specific notifications as read and returns the unread count", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 } as never);

    const response = await POST(request({ ids: [NOTIFICATION_ID] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      unread_count: 0,
    });
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("id = ANY");
    expect(params).toEqual([USER_ID, [NOTIFICATION_ID]]);
  });

  it("marks every notification as read", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 } as never);

    const response = await POST(request({ all: true }));

    expect(response.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).not.toContain("id = ANY");
    expect(params).toEqual([USER_ID]);
  });
});
