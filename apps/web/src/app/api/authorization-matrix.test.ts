import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { signDraftToken } from "@/lib/draft-token";
import { resetEnvCache } from "@/lib/env";
import { hasDashboardSession } from "@/lib/session";

import { POST as ingestDraft } from "./ingest/draft/route";
import { PUT as finalizeIssue } from "./issues/[id]/finalize/route";
import { POST as reconsiderIssue } from "./issues/[id]/reconsider/route";
import { POST as uploadAsset } from "./uploads/route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);

const WORKSPACE_TOKEN = "workspace-token-0123456789abcdef0123456789";
const CDN_AUTH_TOKEN = "cdn-token-0123456789abcdef0123456789abcdef";
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ISSUE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ingestRequest(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/ingest/draft", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      project_id: PROJECT_ID,
      report_type: "text_only",
      environment_info: { url: "https://example.com" },
      console_logs: [],
    }),
  });
}

function finalizeRequest(headers: Record<string, string>, issueId = ISSUE_ID) {
  return new Request(
    `http://localhost:3000/api/issues/${issueId}/finalize`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        title: "Authorization matrix issue",
        description: "checked",
        priority: 50,
      }),
    },
  );
}

function reconsiderRequest(headers: Record<string, string>) {
  return new Request(
    `http://localhost:3000/api/issues/${ISSUE_ID}/reconsider`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        author_role: "developer",
        note: "Authorization matrix note",
      }),
    },
  );
}

function uploadRequest(headers: Record<string, string>, token?: string) {
  const url = new URL("http://localhost:3000/api/uploads");
  url.searchParams.set("issueId", ISSUE_ID);
  if (token) {
    url.searchParams.set("token", token);
  }

  const form = new FormData();
  form.append("category", "reconsider");
  form.append(
    "file",
    new File([new Uint8Array([1, 2, 3])], "matrix.png", {
      type: "image/png",
    }),
  );

  return new Request(url, { method: "POST", headers, body: form });
}

const finalizeContext = { params: Promise.resolve({ id: ISSUE_ID }) };
const reconsiderContext = { params: Promise.resolve({ id: ISSUE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("WORKSPACE_TOKEN", WORKSPACE_TOKEN);
  vi.stubEnv("DRAFT_TOKEN_SECRET", "draft-secret-0123456789abcdef0123456789");
  vi.stubEnv("CDN_AUTH_TOKEN", CDN_AUTH_TOKEN);
  vi.stubEnv("CDN_BASE_URL", "http://127.0.0.1:8080");
  resetEnvCache();
  sessionMock.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

describe("authorization matrix: POST /api/ingest/draft", () => {
  it("denies anonymous callers", async () => {
    const response = await ingestDraft(ingestRequest({}));

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("denies a dashboard session without the workspace token", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await ingestDraft(
      ingestRequest({ cookie: "argus_session=dashboard" }),
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows the extension workspace token", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: PROJECT_ID, key: "ARG" }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ id: ISSUE_ID, issue_number: 1 }],
        rowCount: 1,
      } as never);

    const response = await ingestDraft(
      ingestRequest({ "x-workspace-token": WORKSPACE_TOKEN }),
    );

    expect(response.status).toBe(201);
  });
});

describe("authorization matrix: PUT /api/issues/[id]/finalize", () => {
  function mockSuccessfulFinalize() {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: ISSUE_ID, status: "draft", project_key: "ARG" }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ id: ISSUE_ID, status: "pending" }],
        rowCount: 1,
      } as never);
  }

  it("denies anonymous callers", async () => {
    const response = await finalizeIssue(
      finalizeRequest({}),
      finalizeContext,
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows the anonymous draft holder with a valid draft token", async () => {
    mockSuccessfulFinalize();
    const { token } = signDraftToken(ISSUE_ID);

    const response = await finalizeIssue(
      finalizeRequest({ authorization: `Bearer ${token}` }),
      finalizeContext,
    );

    expect(response.status).toBe(200);
  });

  it("denies a draft token issued for another issue", async () => {
    const { token } = signDraftToken(OTHER_ISSUE_ID);

    const response = await finalizeIssue(
      finalizeRequest({ authorization: `Bearer ${token}` }),
      finalizeContext,
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows an authenticated dashboard user", async () => {
    sessionMock.mockResolvedValue(true);
    mockSuccessfulFinalize();

    const response = await finalizeIssue(
      finalizeRequest({ cookie: "argus_session=dashboard" }),
      finalizeContext,
    );

    expect(response.status).toBe(200);
  });
});

describe("authorization matrix: POST /api/issues/[id]/reconsider", () => {
  function mockSuccessfulNote() {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "note-1" }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
  }

  it("denies anonymous callers", async () => {
    const response = await reconsiderIssue(
      reconsiderRequest({}),
      reconsiderContext,
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("denies the extension workspace token", async () => {
    const response = await reconsiderIssue(
      reconsiderRequest({ "x-workspace-token": WORKSPACE_TOKEN }),
      reconsiderContext,
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows an authenticated dashboard user", async () => {
    sessionMock.mockResolvedValue(true);
    mockSuccessfulNote();

    const response = await reconsiderIssue(
      reconsiderRequest({ cookie: "argus_session=dashboard" }),
      reconsiderContext,
    );

    expect(response.status).toBe(201);
  });
});

describe("authorization matrix: POST /api/uploads", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            success: true,
            url: "http://127.0.0.1:8080/reconsider/2026/11/matrix.png",
            file_size_bytes: 3,
          },
          201,
        ),
      ),
    );
  });

  it("denies anonymous callers", async () => {
    const response = await uploadAsset(uploadRequest({}));

    expect(response.status).toBe(401);
  });

  it("denies a workspace token on its own", async () => {
    const response = await uploadAsset(
      uploadRequest({ "x-workspace-token": WORKSPACE_TOKEN }),
    );

    expect(response.status).toBe(401);
  });

  it("allows a valid draft token", async () => {
    const { token } = signDraftToken(ISSUE_ID);

    const response = await uploadAsset(uploadRequest({}, token));

    expect(response.status).toBe(201);
  });

  it("allows an authenticated dashboard user", async () => {
    sessionMock.mockResolvedValue(true);

    const response = await uploadAsset(
      uploadRequest({ cookie: "argus_session=dashboard" }),
    );

    expect(response.status).toBe(201);
  });
});
