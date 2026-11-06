import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { hasDashboardSession } from "@/lib/session";

import { GET } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";

function request() {
  return new Request(
    `http://localhost:3000/api/issues/${ISSUE_ID}/notes`,
  );
}

const context = { params: Promise.resolve({ id: ISSUE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/issues/[id]/notes", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await GET(request(), context);

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns the chronological audit trail", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValue({
      rows: [
        {
          id: "note-1",
          author_role: "developer",
          note: "Cannot reproduce",
          attachment_urls: ["https://cdn.test/reconsider/log.txt"],
          created_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      rowCount: 1,
    } as never);

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].note).toBe("Cannot reproduce");
    expect(body.notes[0].attachment_urls).toEqual([
      "https://cdn.test/reconsider/log.txt",
    ]);
  });
});
