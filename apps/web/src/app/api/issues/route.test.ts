import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { hasDashboardSession } from "@/lib/session";

import { POST } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);

function request(body: unknown) {
  return new Request("http://localhost:3000/api/issues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/issues", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await POST(
      request({ project_key: "ARG", title: "Manual issue" }),
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("creates a text-only issue in the requested status", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "11111111-1111-4111-8111-111111111111", key: "ARG" }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            issue_number: 7,
            title: "Manual issue",
            description: "details",
            priority: 70,
            status: "working",
            report_type: "text_only",
            updated_at: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        rowCount: 1,
      } as never);

    const response = await POST(
      request({
        project_key: "ARG",
        title: "Manual issue",
        description: "details",
        priority: 70,
        status: "working",
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.issue.issue_number).toBe(7);
    expect(body.issue.status).toBe("working");
  });

  it("rejects an unknown project key", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const response = await POST(
      request({ project_key: "NOPE", title: "Manual issue" }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects a direct reconsider status on create", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await POST(
      request({
        project_key: "ARG",
        title: "Manual issue",
        status: "reconsider",
      }),
    );

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a missing title", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await POST(request({ project_key: "ARG" }));

    expect(response.status).toBe(422);
  });

  it("creates a screenshot issue with supplementary attachments", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "11111111-1111-4111-8111-111111111111", key: "ARG" }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            issue_number: 8,
            title: "Screenshot issue",
            description: null,
            priority: 50,
            status: "pending",
            report_type: "screenshot",
            updated_at: new Date("2026-01-01T00:00:00Z"),
          },
        ],
        rowCount: 1,
      } as never)
      .mockResolvedValue({ rows: [], rowCount: 1 } as never);

    const response = await POST(
      request({
        project_key: "ARG",
        title: "Screenshot issue",
        report_type: "screenshot",
        raw_image_url: "http://127.0.0.1:18130/raw/2026/11/a.png",
        supplementary_assets: [
          {
            url: "http://127.0.0.1:18130/reconsider/2026/11/b.png",
            asset_type: "image/png",
          },
        ],
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.issue.report_type).toBe("screenshot");
    // project lookup + insert + 1 supplementary insert
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a screenshot report without any image", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await POST(
      request({
        project_key: "ARG",
        title: "Screenshot issue",
        report_type: "screenshot",
      }),
    );

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
