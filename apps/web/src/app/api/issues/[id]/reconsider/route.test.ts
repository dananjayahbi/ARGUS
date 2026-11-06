import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { hasDashboardSession } from "@/lib/session";

import { POST } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request(
    `http://localhost:3000/api/issues/${ISSUE_ID}/reconsider`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const context = { params: Promise.resolve({ id: ISSUE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/issues/[id]/reconsider", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await POST(
      request({ author_role: "developer", note: "blocked" }),
      context,
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("moves a developer note into Reconsider and stores the note", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "note-1" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const response = await POST(
      request({ author_role: "developer", note: "Cannot reproduce" }),
      context,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      note_id: "note-1",
      current_status: "reconsider",
    });

    const insertCall = queryMock.mock.calls[0] as [string, unknown[]];
    expect(insertCall[0]).toContain("INSERT INTO issue_reconsider_notes");
    expect(insertCall[1]).toEqual([
      ISSUE_ID,
      "developer",
      "Cannot reproduce",
      null,
    ]);
  });

  it("returns a QA reply to Working", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "note-2" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const response = await POST(
      request({ author_role: "qa", note: "Added logs" }),
      context,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      note_id: "note-2",
      current_status: "working",
    });
  });

  it("stores attachment URLs with the note", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "note-3" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const response = await POST(
      request({
        author_role: "developer",
        note: "See the attached trace",
        attachment_urls: [
          "https://cdn.test/reconsider/2026/11/trace.png",
        ],
      }),
      context,
    );

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls[0] as [string, unknown[]];
    expect(insertCall[1][3]).toEqual([
      "https://cdn.test/reconsider/2026/11/trace.png",
    ]);
  });

  it("rejects an empty note", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await POST(
      request({ author_role: "developer", note: "   " }),
      context,
    );

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
