import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { getRequestSession } from "@/lib/session";

import { PATCH } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ getRequestSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(getRequestSession);

const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const PREVIOUS_ID = "33333333-3333-4333-8333-333333333333";
const NEXT_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const session = {
  sessionId: "session-1",
  user: { id: "user-1", email: "qa@example.com", role: "qa" as const },
};

const context = { params: Promise.resolve({ id: ISSUE_ID }) };

const updatedIssue = {
  id: ISSUE_ID,
  issue_number: 12,
  title: "Moved issue",
  description: null,
  priority: 50,
  status: "working",
  report_type: "text_only",
  raw_image_url: null,
  annotated_image_url: null,
  updated_at: new Date("2026-11-07T10:00:00Z"),
  created_at: new Date("2026-11-01T10:00:00Z"),
  board_order: 2500,
};

function request(body: unknown) {
  return new Request(
    `http://localhost:3000/api/issues/${ISSUE_ID}/position`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/issues/[id]/position", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(null);

    const response = await PATCH(
      request({ status: "working", previous_issue_id: PREVIOUS_ID }),
      context,
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects Reconsider and invalid positions", async () => {
    sessionMock.mockResolvedValue(session);

    const reconsider = await PATCH(request({ status: "reconsider" }), context);
    const sameNeighbour = await PATCH(
      request({
        status: "working",
        previous_issue_id: PREVIOUS_ID,
        next_issue_id: PREVIOUS_ID,
      }),
      context,
    );

    expect(reconsider.status).toBe(422);
    expect(sameNeighbour.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue does not exist", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const response = await PATCH(
      request({ status: "working", previous_issue_id: null }),
      context,
    );

    expect(response.status).toBe(404);
  });

  it("places the issue between two neighbours", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({
        rows: [{ project_id: PROJECT_ID }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [{ board_order: 2000 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ board_order: 3000 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [updatedIssue], rowCount: 1 } as never);

    const response = await PATCH(
      request({
        status: "working",
        previous_issue_id: PREVIOUS_ID,
        next_issue_id: NEXT_ID,
      }),
      context,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue.board_order).toBe(2500);
    const updateCall = queryMock.mock.calls[3];
    expect(updateCall[1]).toEqual([ISSUE_ID, "working", 2500]);
  });

  it("appends the issue when the target column is empty", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({
        rows: [{ project_id: PROJECT_ID }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [{ max_order: 4096 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{ ...updatedIssue, board_order: 5120 }],
        rowCount: 1,
      } as never);

    const response = await PATCH(
      request({
        status: "working",
        previous_issue_id: null,
        next_issue_id: null,
      }),
      context,
    );

    expect(response.status).toBe(200);
    const updateCall = queryMock.mock.calls[2];
    expect(updateCall[1]).toEqual([ISSUE_ID, "working", 5120]);
  });

  it("renumbers a column when the midpoint gap is exhausted", async () => {
    sessionMock.mockResolvedValue(session);
    queryMock
      .mockResolvedValueOnce({
        rows: [{ project_id: PROJECT_ID }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ board_order: 2000 }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ board_order: 2000.00001 }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 5 } as never)
      .mockResolvedValueOnce({
        rows: [{ board_order: 2000 }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ board_order: 3000 }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [updatedIssue], rowCount: 1 } as never);

    const response = await PATCH(
      request({
        status: "working",
        previous_issue_id: PREVIOUS_ID,
        next_issue_id: NEXT_ID,
      }),
      context,
    );

    expect(response.status).toBe(200);
    const renumberCall = queryMock.mock.calls[3];
    expect(String(renumberCall[0])).toContain("row_number()");
    const updateCall = queryMock.mock.calls[6];
    expect(updateCall[1]).toEqual([ISSUE_ID, "working", 2500]);
  });
});
