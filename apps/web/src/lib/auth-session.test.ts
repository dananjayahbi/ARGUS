import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAuthConfigCache } from "./auth-config";
import {
  sessionCookieOptions,
  signSessionJwt,
  verifySessionJwt,
} from "./auth-session";

const claims = {
  sid: "11111111-1111-4111-8111-111111111111",
  sub: "22222222-2222-4222-8222-222222222222",
  email: "qa@argus.local",
  role: "qa" as const,
};

beforeEach(() => {
  vi.stubEnv(
    "SESSION_SECRET",
    "session-secret-0123456789abcdef0123456789",
  );
  vi.stubEnv("QA_EMAIL", "qa@argus.local");
  vi.stubEnv("QA_PASSWORD", "qa123");
  vi.stubEnv("DEVELOPER_EMAIL", "dev@argus.local");
  vi.stubEnv("DEVELOPER_PASSWORD", "dev123");
  resetAuthConfigCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthConfigCache();
});

describe("session JWT", () => {
  it("round-trips the session claims", async () => {
    const token = await signSessionJwt(claims);
    const verified = await verifySessionJwt(token);

    expect(verified).toMatchObject(claims);
    expect(verified?.exp).toBeGreaterThan(verified?.iat ?? 0);
  });

  it("rejects a tampered token", async () => {
    const token = await signSessionJwt(claims);
    const [header, payload, signature] = token.split(".");
    const tamperedSignature = `${
      signature.startsWith("A") ? "B" : "A"
    }${signature.slice(1)}`;
    const tampered = `${header}.${payload}.${tamperedSignature}`;

    expect(await verifySessionJwt(tampered)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({
      sid: claims.sid,
      email: claims.email,
      role: claims.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt(now - 100)
      .setExpirationTime(now - 10)
      .sign(
        new TextEncoder().encode(
          "session-secret-0123456789abcdef0123456789",
        ),
      );

    expect(await verifySessionJwt(expired)).toBeNull();
  });

  it("sets httpOnly and sameSite=lax, secure only in production", () => {
    const development = sessionCookieOptions();
    expect(development.httpOnly).toBe(true);
    expect(development.sameSite).toBe("lax");
    expect(development.secure).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
  });
});
