import type { QueryResult, QueryResultRow } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { signDraftToken } from "@/lib/draft-token";
import { resetEnvCache } from "@/lib/env";

import { PUT } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const queryMock = vi.mocked(query);
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ISSUE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_KEY = "ARG";

function queryResult(rows: QueryResultRow[]): QueryResult<QueryResultRow> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function tokenFor(issueId = ISSUE_ID, now = new Date()): string {
  return signDraftToken(issueId, { now }).token;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Checkout button overlaps total",
    description: "Steps to reproduce...",
    priority: 75,
    annotated_image_url: "https://cdn.example/annotated/2026/11/annotated.png",
    canvas_state: { version: "1", objects: [] },
    audio_note_url: "https://cdn.example/audio/2026/11/note.webm",
    ...overrides,
  };
}

function request(
  body: unknown,
  options: {
    id?: string;
    token?: string;
    bearer?: string;
  } = {},
) {
  const id = options.id ?? ISSUE_ID;
  const url = new URL(`http://localhost:3000/api/issues/${id}/finalize`);
  if (options.token) {
    url.searchParams.set("token", options.token);
  }

  return new Request(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(options.bearer
        ? { authorization: `Bearer ${options.bearer}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

async function call(requestValue: Request, id = ISSUE_ID) {
  return PUT(requestValue, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("WORKSPACE_TOKEN", "workspace-token-0123456789abcdef0123456789");
  vi.stubEnv("DRAFT_TOKEN_SECRET", "draft-secret-0123456789abcdef0123456789");
  vi.stubEnv("CDN_AUTH_TOKEN", "cdn-token-0123456789abcdef0123456789abcdef");
  vi.stubEnv("CDN_BASE_URL", "http://127.0.0.1:8080");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("PUT /api/issues/[id]/finalize", () => {
  it("finalizes a draft and returns the project redirect", async () => {
    queryMock
      .mockResolvedValueOnce(
        queryResult([{ id: ISSUE_ID, status: "draft", project_key: PROJECT_KEY }]),
      )
      .mockResolvedValueOnce(
        queryResult([{ id: ISSUE_ID, status: "pending" }]),
      );

    const response = await call(request(payload(), { token: tokenFor() }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      status: "pending",
      redirect_url: "/projects/ARG",
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const updateCall = queryMock.mock.calls[1] as [string, unknown[]];
    expect(updateCall[0]).toContain("status = 'pending'");
    expect(updateCall[1][1]).toBe("Checkout button overlaps total");
    expect(updateCall[1][5]).toBe(JSON.stringify(payload().canvas_state));
  });

  it("persists supplementary assets with the finalized issue", async () => {
    queryMock
      .mockResolvedValueOnce(
        queryResult([{ id: ISSUE_ID, status: "draft", project_key: PROJECT_KEY }]),
      )
      .mockResolvedValueOnce(
        queryResult([{ id: ISSUE_ID, status: "pending" }]),
      )
      .mockResolvedValueOnce(queryResult([]));

    const response = await call(
      request(
        payload({
          supplementary_assets: [
            {
              url: "https://cdn.example/reconsider/a.png",
              asset_type: "image/png",
            },
          ],
        }),
        { token: tokenFor() },
      ),
    );

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(3);
    const insertCall = queryMock.mock.calls[2] as [string, unknown[]];
    expect(insertCall[0]).toContain("INSERT INTO issue_supplementary_assets");
    expect(insertCall[1]).toEqual([
      ISSUE_ID,
      "https://cdn.example/reconsider/a.png",
      "image/png",
    ]);
  });

  it("accepts the token from a Bearer header", async () => {
    queryMock
      .mockResolvedValueOnce(
        queryResult([{ id: ISSUE_ID, status: "draft", project_key: PROJECT_KEY }]),
      )
      .mockResolvedValueOnce(
        queryResult([{ id: ISSUE_ID, status: "pending" }]),
      );

    const response = await call(
      request(payload(), { bearer: tokenFor() }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects an expired token without querying", async () => {
    const expired = tokenFor(
      ISSUE_ID,
      new Date(Date.now() - 31 * 60 * 1000),
    );

    const response = await call(request(payload(), { token: expired }));

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a tampered token without querying", async () => {
    const token = tokenFor();
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    const response = await call(request(payload(), { token: tampered }));

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a token issued for a different issue", async () => {
    const response = await call(
      request(payload(), { token: tokenFor(OTHER_ISSUE_ID) }),
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("requires a token when no dashboard session exists", async () => {
    const response = await call(request(payload()));

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects priority 101 with 422", async () => {
    const response = await call(
      request(payload({ priority: 101 }), { token: tokenFor() }),
    );

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a missing title with 422", async () => {
    const response = await call(
      request(payload({ title: "   " }), { token: tokenFor() }),
    );

    expect(response.status).toBe(422);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 409 for an already-pending issue", async () => {
    queryMock.mockResolvedValueOnce(
      queryResult([
        { id: ISSUE_ID, status: "pending", project_key: PROJECT_KEY },
      ]),
    );

    const response = await call(request(payload(), { token: tokenFor() }));

    expect(response.status).toBe(409);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for an unknown issue", async () => {
    queryMock.mockResolvedValueOnce(queryResult([]));

    const response = await call(request(payload(), { token: tokenFor() }));

    expect(response.status).toBe(404);
  });
});
