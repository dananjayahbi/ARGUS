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
  return new Request(`http://localhost:3000/api/issues/${ISSUE_ID}`);
}

const context = { params: Promise.resolve({ id: ISSUE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/issues/[id]", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await GET(request(), context);

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns the issue, project, notes and supplementary assets", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: ISSUE_ID,
            issue_number: 12,
            title: "Checkout bug",
            description: "Steps",
            priority: 82,
            status: "pending",
            report_type: "screenshot",
            raw_image_url: "https://cdn.test/raw/a.png",
            annotated_image_url: "https://cdn.test/annotated/a.png",
            canvas_state: { version: 1, width: 10, height: 10, nodes: [] },
            audio_note_url: null,
            environment_info: { url: "https://example.com" },
            console_logs: [],
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-02T00:00:00Z"),
            project_id: "33333333-3333-4333-8333-333333333333",
            project_key: "ARG",
            project_name: "ARGUS",
          },
        ],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "note-1",
            author_role: "developer",
            note: "Cannot reproduce",
            attachment_urls: null,
            created_at: new Date("2026-01-03T00:00:00Z"),
          },
        ],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "asset-1",
            asset_url: "https://cdn.test/reconsider/a.png",
            asset_type: "image/png",
            created_at: new Date("2026-01-03T00:00:00Z"),
          },
        ],
        rowCount: 1,
      } as never);

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue.issue_number).toBe(12);
    expect(body.issue.canvas_state).toEqual({
      version: 1,
      width: 10,
      height: 10,
      nodes: [],
    });
    expect(body.project).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      key: "ARG",
      name: "ARGUS",
    });
    expect(body.notes).toHaveLength(1);
    expect(body.supplementary_assets[0].asset_url).toBe(
      "https://cdn.test/reconsider/a.png",
    );
  });

  it("returns 404 for an unknown issue", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const response = await GET(request(), context);

    expect(response.status).toBe(404);
  });
});
