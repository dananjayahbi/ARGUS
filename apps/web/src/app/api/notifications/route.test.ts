import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { getRequestSession } from "@/lib/session";

import { GET } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ getRequestSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(getRequestSession);

const USER_ID = "44444444-4444-4444-8444-444444444444";
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const NOTIFICATION_ID = "77777777-7777-4777-8777-777777777777";

const session = {
  sessionId: "session-1",
  user: { id: USER_ID, email: "dev@example.com", role: "developer" as const },
};

const notificationRow = {
  id: NOTIFICATION_ID,
  issue_id: ISSUE_ID,
  comment_id: COMMENT_ID,
  actor_role: "qa",
  actor_email: "qa@example.com",
  read_at: null,
  created_at: new Date("2026-11-07T10:00:00Z"),
  issue_number: 12,
  issue_title: "Checkout total is wrong",
  project_key: "ARG",
  project_name: "ARGUS",
  comment_body: "Can you reproduce this?",
  comment_author_role: "qa",
};

function request() {
  return new Request("http://localhost:3000/api/notifications");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/notifications", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns the notification feed and unread count", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({ rows: [notificationRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.unread_count).toBe(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]).toMatchObject({
      id: NOTIFICATION_ID,
      issue_id: ISSUE_ID,
      comment_id: COMMENT_ID,
      issue_number: 12,
      project_key: "ARG",
      actor_role: "qa",
      comment_body: "Can you reproduce this?",
    });
  });
});
