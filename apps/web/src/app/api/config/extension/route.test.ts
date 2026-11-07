import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { hasDashboardSession } from "@/lib/session";

import { GET } from "./route";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasDashboardSession: vi.fn() }));

const queryMock = vi.mocked(query);
const sessionMock = vi.mocked(hasDashboardSession);

function request() {
  return new Request("http://localhost:13130/api/config/extension", {
    headers: { host: "localhost:13130" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("WORKSPACE_TOKEN", "workspace-token-0123456789abcdef0123456789");
  vi.stubEnv("DRAFT_TOKEN_SECRET", "draft-secret-0123456789abcdef0123456789");
  vi.stubEnv("CDN_AUTH_TOKEN", "cdn-token-0123456789abcdef0123456789abcdef");
  vi.stubEnv("CDN_BASE_URL", "http://127.0.0.1:18130");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("GET /api/config/extension", () => {
  it("requires a dashboard session", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns URLs, tokens and projects without caching", async () => {
    sessionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "ac77dd20-e321-4d5a-9943-fe1c4e521555",
          name: "ARGUS",
          key: "ARG",
        },
      ],
      rowCount: 1,
    } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.appBaseUrl).toBe("http://localhost:13130");
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].key).toBe("ARG");
    expect(typeof body.workspaceToken).toBe("string");
    expect(typeof body.cdnToken).toBe("string");
  });
});
