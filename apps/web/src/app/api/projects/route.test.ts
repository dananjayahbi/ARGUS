import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { hasDashboardSession } from "@/lib/session";

import { GET, POST } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);

function request(body?: unknown) {
  return new Request(
    "http://localhost:3000/api/projects",
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/projects", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("lists projects", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "ARGUS",
          key: "ARG",
          description: null,
          created_at: new Date("2026-01-01T00:00:00Z"),
          updated_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      rowCount: 1,
    } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects[0].key).toBe("ARG");
  });
});

describe("POST /api/projects", () => {
  it("creates a project", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Mobile app",
          key: "MOB",
          description: "details",
          created_at: new Date("2026-01-01T00:00:00Z"),
          updated_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      rowCount: 1,
    } as never);

    const response = await POST(
      request({ name: "Mobile app", key: "MOB", description: "details" }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.project.key).toBe("MOB");
  });

  it("returns 409 for a duplicate key", async () => {
    sessionMock.mockResolvedValue(true);
    const error = new Error("duplicate") as Error & { code: string };
    error.code = "23505";
    queryMock.mockRejectedValueOnce(error);

    const response = await POST(request({ name: "ARGUS", key: "ARG" }));

    expect(response.status).toBe(409);
  });

  it("rejects an invalid payload", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await POST(request({ name: "", key: "" }));

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
