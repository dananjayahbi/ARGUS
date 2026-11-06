import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { hasDashboardSession } from "@/lib/session";

import { PATCH } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request(`http://localhost:3000/api/issues/${ISSUE_ID}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: ISSUE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/issues/[id]/status", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await PATCH(request({ status: "working" }), context);

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("persists a valid non-Reconsider transition", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValue({
      rows: [
        {
          id: ISSUE_ID,
          issue_number: 1,
          title: "Test issue",
          priority: 50,
          status: "working",
          report_type: "screenshot",
          updated_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      rowCount: 1,
    } as never);

    const response = await PATCH(request({ status: "working" }), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue.status).toBe("working");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid status", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await PATCH(request({ status: "archived" }), context);

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a direct Reconsider transition", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await PATCH(request({ status: "reconsider" }), context);

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
