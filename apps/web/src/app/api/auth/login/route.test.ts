import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { query } from "@/lib/db";
import { authenticate } from "@/lib/users";

import { resetAuthConfigCache } from "@/lib/auth-config";
import { POST } from "./route";

vi.mock("@/lib/users", () => ({ authenticate: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const authenticateMock = vi.mocked(authenticate);
const queryMock = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
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

function request(body: unknown) {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  it("sets an httpOnly lax session cookie for valid credentials", async () => {
    authenticateMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      email: "qa@argus.local",
      role: "qa",
      password_hash: "argon2-hash",
    });
    queryMock.mockResolvedValue({
      rows: [],
      rowCount: 1,
    } as never);

    const response = await POST(
      request({ email: "qa@argus.local", password: "qa123" }),
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("argus_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).not.toContain("Secure");
  });

  it("rejects invalid credentials without creating a session", async () => {
    authenticateMock.mockResolvedValue(null);

    const response = await POST(
      request({ email: "qa@argus.local", password: "wrong" }),
    );

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
  });
});
