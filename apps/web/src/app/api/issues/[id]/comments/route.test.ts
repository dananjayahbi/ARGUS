import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { getRequestSession } from "@/lib/session";

import { GET, POST } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ getRequestSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(getRequestSession);

const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const ATTACHMENT_ID = "66666666-6666-4666-8666-666666666666";

const session = {
  sessionId: "session-1",
  user: { id: USER_ID, email: "qa@example.com", role: "qa" as const },
};

const context = { params: Promise.resolve({ id: ISSUE_ID }) };

function getRequest() {
  return new Request(`http://localhost:3000/api/issues/${ISSUE_ID}/comments`);
}

function postRequest(body: unknown) {
  return new Request(
    `http://localhost:3000/api/issues/${ISSUE_ID}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const commentRow = {
  id: COMMENT_ID,
  author_user_id: USER_ID,
  author_role: "qa",
  body: "Please retest on Chrome.",
  created_at: new Date("2026-11-07T10:00:00Z"),
};

const attachmentRow = {
  id: ATTACHMENT_ID,
  comment_id: COMMENT_ID,
  asset_url: "https://cdn.test/reconsider/2026/11/log.txt",
  asset_type: "text/plain",
  file_name: "console.log",
  size_bytes: 42,
  created_at: new Date("2026-11-07T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/issues/[id]/comments", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(null);

    const response = await GET(getRequest(), context);

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns comments with nested attachments and the viewer", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({ rows: [commentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [attachmentRow], rowCount: 1 } as never);

    const response = await GET(getRequest(), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.viewer).toEqual(session.user);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe("Please retest on Chrome.");
    expect(body.comments[0].attachments).toEqual([
      {
        id: ATTACHMENT_ID,
        url: attachmentRow.asset_url,
        asset_type: "text/plain",
        file_name: "console.log",
        size_bytes: 42,
        created_at: attachmentRow.created_at.toISOString(),
      },
    ]);
  });
});

describe("POST /api/issues/[id]/comments", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(null);

    const response = await POST(postRequest({ body: "hello" }), context);

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects an empty comment without attachments", async () => {
    sessionMock.mockResolvedValue(session);

    const response = await POST(postRequest({ body: "   " }), context);

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("stores the comment, attachments, issue touch and notifications", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({ rows: [commentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [attachmentRow], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const response = await POST(
      postRequest({
        body: "Please retest on Chrome.",
        attachments: [
          {
            url: attachmentRow.asset_url,
            asset_type: attachmentRow.asset_type,
            file_name: attachmentRow.file_name,
            size_bytes: attachmentRow.size_bytes,
          },
        ],
      }),
      context,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.comment.id).toBe(COMMENT_ID);
    expect(body.comment.author_role).toBe("qa");
    expect(body.comment.attachments).toHaveLength(1);
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO notifications"),
      ),
    ).toBe(true);
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE issues"),
      ),
    ).toBe(true);
  });

  it("returns 404 when the issue does not exist", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock.mockRejectedValueOnce(
      Object.assign(new Error("fk"), { code: "23503" }),
    );

    const response = await POST(postRequest({ body: "hello" }), context);

    expect(response.status).toBe(404);
  });
});
