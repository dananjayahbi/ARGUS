import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWorkspaceToken } from "./auth";
import { resetEnvCache } from "./env";

const TOKEN = "workspace-token-0123456789abcdef0123456789";

beforeEach(() => {
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

function request(token?: string): Request {
  return new Request("http://localhost:3000/api/ingest/draft", {
    headers: token ? { "x-workspace-token": token } : {},
  });
}

describe("verifyWorkspaceToken", () => {
  it("accepts the configured token", () => {
    expect(verifyWorkspaceToken(request(TOKEN))).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(verifyWorkspaceToken(request())).toBe(false);
  });

  it("rejects a wrong token of the same length", () => {
    expect(verifyWorkspaceToken(request("x".repeat(TOKEN.length)))).toBe(false);
  });

  it("rejects a wrong token of a different length", () => {
    expect(verifyWorkspaceToken(request("short"))).toBe(false);
  });
});
