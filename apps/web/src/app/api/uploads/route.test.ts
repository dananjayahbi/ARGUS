import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signDraftToken } from "@/lib/draft-token";
import { resetEnvCache } from "@/lib/env";
import { hasDashboardSession } from "@/lib/session";

import { POST } from "./route";

vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const sessionMock = vi.mocked(hasDashboardSession);

const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const CDN_BASE = "http://127.0.0.1:8080";
const CDN_TOKEN = "cdn-token-0123456789abcdef0123456789abcdef";

beforeEach(() => {
  sessionMock.mockResolvedValue(false);
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("WORKSPACE_TOKEN", "workspace-token-0123456789abcdef0123456789");
  vi.stubEnv("DRAFT_TOKEN_SECRET", "draft-secret-0123456789abcdef0123456789");
  vi.stubEnv("CDN_AUTH_TOKEN", CDN_TOKEN);
  vi.stubEnv("CDN_BASE_URL", CDN_BASE);
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

function uploadRequest(options: {
  token?: string | null;
  category?: string;
  issueId?: string;
  file?: Blob | null;
} = {}) {
  const {
    token = signDraftToken(ISSUE_ID).token,
    category = "reconsider",
    issueId = ISSUE_ID,
    file = new File([new Uint8Array([1, 2, 3])], "paste.png", {
      type: "image/png",
    }),
  } = options;

  const url = new URL("http://localhost:3000/api/uploads");
  url.searchParams.set("issueId", issueId);
  if (token) {
    url.searchParams.set("token", token);
  }

  const form = new FormData();
  form.append("category", category);
  if (file) {
    form.append("file", file, "paste.png");
  }

  return new Request(url, { method: "POST", body: form });
}

describe("POST /api/uploads", () => {
  it("forwards a valid upload to the CDN with the server-side token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          url: "http://127.0.0.1:8080/reconsider/2026/11/paste.png",
          file_size_bytes: 3,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ success: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CDN_BASE}/api/upload`);
    expect((init.headers as Record<string, string>)["X-CDN-Auth-Token"]).toBe(
      CDN_TOKEN,
    );
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("rejects a missing draft token without calling the CDN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(uploadRequest({ token: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a token issued for another issue", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      uploadRequest({
        token: signDraftToken("33333333-3333-4333-8333-333333333333").token,
      }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown category", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(uploadRequest({ category: "temp" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the CDN is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const response = await POST(uploadRequest());

    expect(response.status).toBe(503);
  });

  it("allows a dashboard-session attachment upload without a draft token", async () => {
    sessionMock.mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          url: "http://cdn.test/reconsider/2026/11/attachment.png",
          file_size_bytes: 3,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(uploadRequest({ token: null }));

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
