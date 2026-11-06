import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentError, getEnv, resetEnvCache } from "./env";

const VALID_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  WORKSPACE_TOKEN: "workspace-token-0123456789abcdef0123456789",
  DRAFT_TOKEN_SECRET: "draft-secret-0123456789abcdef0123456789",
  CDN_AUTH_TOKEN: "cdn-token-0123456789abcdef0123456789abcdef",
  CDN_BASE_URL: "http://127.0.0.1:8080/",
  NODE_ENV: "test",
} as const;

function stubValidEnv() {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  resetEnvCache();
  stubValidEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("getEnv", () => {
  it("parses a valid environment and strips the CDN trailing slash", () => {
    const env = getEnv();

    expect(env.CDN_BASE_URL).toBe("http://127.0.0.1:8080");
    expect(env.WORKSPACE_TOKEN.length).toBeGreaterThanOrEqual(32);
  });

  it("reports every missing variable in one readable error", () => {
    for (const key of Object.keys(VALID_ENV)) {
      vi.stubEnv(key, undefined);
    }
    resetEnvCache();

    let error: unknown;
    try {
      getEnv();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as EnvironmentError).issues).toHaveLength(5);
    const message = (error as Error).message;
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("WORKSPACE_TOKEN");
    expect(message).toContain("DRAFT_TOKEN_SECRET");
    expect(message).toContain("CDN_AUTH_TOKEN");
    expect(message).toContain("CDN_BASE_URL");
    expect(message).toContain("apps/web/.env.local");
  });

  it("rejects short secrets and non-absolute URLs", () => {
    vi.stubEnv("WORKSPACE_TOKEN", "too-short");
    vi.stubEnv("CDN_BASE_URL", "not-a-url");
    resetEnvCache();

    expect(() => getEnv()).toThrow(/WORKSPACE_TOKEN: .*at least 32/);
    expect(() => getEnv()).toThrow(/CDN_BASE_URL: .*absolute URL/);
  });

  it("rejects placeholder and low-entropy secrets", () => {
    vi.stubEnv(
      "WORKSPACE_TOKEN",
      "replace-with-at-least-32-random-characters",
    );
    resetEnvCache();

    expect(() => getEnv()).toThrow(/WORKSPACE_TOKEN: .*high-entropy/);

    vi.stubEnv("WORKSPACE_TOKEN", "x".repeat(32));
    resetEnvCache();

    expect(() => getEnv()).toThrow(/WORKSPACE_TOKEN: .*high-entropy/);
  });
});
