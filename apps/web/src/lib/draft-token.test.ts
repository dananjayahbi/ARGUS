import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_TOKEN_TTL_SECONDS,
  signDraftToken,
  verifyDraftToken,
  verifyDraftTokenForIssue,
} from "./draft-token";
import { resetEnvCache } from "./env";

const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ISSUE_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = "draft-secret-0123456789abcdef0123456789";
const ISSUED_AT = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
  vi.stubEnv("WORKSPACE_TOKEN", "workspace-token-0123456789abcdef0123456789");
  vi.stubEnv("DRAFT_TOKEN_SECRET", SECRET);
  vi.stubEnv("CDN_AUTH_TOKEN", "cdn-token-0123456789abcdef0123456789abcdef");
  vi.stubEnv("CDN_BASE_URL", "http://127.0.0.1:8080");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("draft tokens", () => {
  it("issues a 30-minute token scoped to the issue", () => {
    const { token, expiresAt } = signDraftToken(ISSUE_ID, { now: ISSUED_AT });

    expect(expiresAt.toISOString()).toBe("2026-01-01T00:30:00.000Z");
    expect(DRAFT_TOKEN_TTL_SECONDS).toBe(1800);

    const verified = verifyDraftToken(token, {
      now: new Date("2026-01-01T00:10:00.000Z"),
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.sub).toBe(ISSUE_ID);
      expect(verified.payload.scope).toBe("canvas:draft");
      expect(verified.payload.exp).toBe(
        Math.floor(expiresAt.getTime() / 1000),
      );
    }
  });

  it("rejects an expired token", () => {
    const { token } = signDraftToken(ISSUE_ID, { now: ISSUED_AT });

    const verified = verifyDraftToken(token, {
      now: new Date("2026-01-01T00:30:01.000Z"),
    });

    expect(verified).toEqual({ ok: false, error: "expired" });
  });

  it("rejects a tampered signature", () => {
    const { token } = signDraftToken(ISSUE_ID, { now: ISSUED_AT });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(verifyDraftToken(tampered)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = signDraftToken(ISSUE_ID, { now: ISSUED_AT });
    vi.stubEnv("DRAFT_TOKEN_SECRET", "another-secret-0123456789abcdef0123456789");
    resetEnvCache();

    expect(verifyDraftToken(token)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });

  it("rejects a malformed token", () => {
    expect(verifyDraftToken("not-a-token")).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("binds the token to exactly one issue", () => {
    const { token } = signDraftToken(ISSUE_ID, { now: ISSUED_AT });
    const now = new Date("2026-01-01T00:10:00.000Z");

    expect(verifyDraftTokenForIssue(token, ISSUE_ID, { now }).ok).toBe(true);
    expect(verifyDraftTokenForIssue(token, OTHER_ISSUE_ID, { now })).toEqual({
      ok: false,
      error: "wrong_issue",
    });
  });
});
