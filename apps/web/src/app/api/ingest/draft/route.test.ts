import type { QueryResult, QueryResultRow } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";

import { POST } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const queryMock = vi.mocked(query);
const TOKEN = "workspace-token-0123456789abcdef0123456789";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";

function queryResult(rows: QueryResultRow[]): QueryResult<QueryResultRow> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    project_id: PROJECT_ID,
    report_type: "screenshot",
    raw_image_url: "https://cdn.example/raw/2026/11/shot.png",
    environment_info: {
      url: "https://target.example",
      viewport: { width: 1280, height: 720 },
    },
    console_logs: [
      {
        type: "error",
        message: "boom",
        timestamp: "2026-11-06T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function request(body: unknown, token: string | null = TOKEN) {
  return new Request("http://localhost:3000/api/ingest/draft", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-workspace-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("WORKSPACE_TOKEN", TOKEN);
  vi.stubEnv("DRAFT_TOKEN_SECRET", "draft-secret-0123456789abcdef0123456789");
  vi.stubEnv("CDN_AUTH_TOKEN", "cdn-token-0123456789abcdef0123456789abcdef");
  vi.stubEnv("CDN_BASE_URL", "http://127.0.0.1:8080");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("POST /api/ingest/draft", () => {
  it("rejects a missing token without touching the database", async () => {
    const response = await POST(request(payload(), null));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing workspace authorization token.",
      },
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong token without touching the database", async () => {
    const response = await POST(request(payload(), "wrong-token"));

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("creates a draft and returns the editor URL", async () => {
    queryMock
      .mockResolvedValueOnce(queryResult([{ id: PROJECT_ID, key: "ARG" }]))
      .mockResolvedValueOnce(queryResult([{ id: ISSUE_ID, issue_number: 7 }]));

    const response = await POST(request(payload()));

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      issue_id: string;
      draft_token: string;
      editor_url: string;
    };

    expect(body.issue_id).toBe(ISSUE_ID);
    expect(body.draft_token.split(".")).toHaveLength(3);
    expect(body.editor_url).toBe(
      `http://localhost:3000/canvas/${ISSUE_ID}?token=${encodeURIComponent(body.draft_token)}`,
    );

    expect(queryMock).toHaveBeenCalledTimes(2);
    const insertCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(insertCall[0]).toContain("INSERT INTO issues");
    expect(insertCall[1][6]).toBe(
      JSON.stringify(payload().environment_info),
    );
    expect(insertCall[1][7]).toBe(JSON.stringify(payload().console_logs));
    expect(insertCall[1][8]).toBe(body.draft_token);
    expect(typeof insertCall[1][9]).toBe("string");
    expect(new Date(insertCall[1][9] as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("accepts text_only without a raw image", async () => {
    queryMock
      .mockResolvedValueOnce(queryResult([{ id: PROJECT_ID, key: "ARG" }]))
      .mockResolvedValueOnce(queryResult([{ id: ISSUE_ID, issue_number: 8 }]));

    const response = await POST(
      request(payload({ report_type: "text_only", raw_image_url: undefined })),
    );

    expect(response.status).toBe(201);
  });

  it("rejects a screenshot without a raw image before querying", async () => {
    const response = await POST(request(payload({ raw_image_url: undefined })));

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown project", async () => {
    queryMock.mockResolvedValueOnce(queryResult([]));

    const response = await POST(request(payload()));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Project not found.",
        details: { project_id: PROJECT_ID },
      },
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("does not leak database errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryMock.mockRejectedValueOnce(
      new Error('relation "projects" does not exist'),
    );

    const response = await POST(request(payload()));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to create the draft.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("relation");
  });
});
