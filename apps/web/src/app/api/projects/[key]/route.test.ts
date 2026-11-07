import { beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { hasDashboardSession } from "@/lib/session";

import { DELETE, PATCH } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);
const context = { params: Promise.resolve({ key: "ARG" }) };

function patchRequest(body: unknown) {
  return new Request("http://localhost:3000/api/projects/ARG", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new Request("http://localhost:3000/api/projects/ARG", {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/projects/[key]", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await PATCH(patchRequest({ name: "New name" }), context);

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("updates the project", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({
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
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "New name",
            key: "ARG",
            description: null,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-02T00:00:00Z"),
          },
        ],
        rowCount: 1,
      } as never);

    const response = await PATCH(patchRequest({ name: "New name" }), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project.name).toBe("New name");
  });
});

describe("DELETE /api/projects/[key]", () => {
  it("deletes an existing project", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "11111111-1111-4111-8111-111111111111", key: "ARG" }],
      rowCount: 1,
    } as never);

    const response = await DELETE(deleteRequest(), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, key: "ARG" });
  });

  it("returns 404 for an unknown project", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const response = await DELETE(deleteRequest(), context);

    expect(response.status).toBe(404);
  });
});
