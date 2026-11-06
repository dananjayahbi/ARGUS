import type { ErrorEvent } from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSentryOptions, scrubSentryEvent } from "./sentry-options";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sentry options", () => {
  it("stays disabled when no DSN is configured", () => {
    vi.stubEnv("SENTRY_DSN", "");

    expect(buildSentryOptions()).toBeNull();
  });

  it("carries environment, release and PII settings when configured", () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.com/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("SENTRY_RELEASE", "argus-web@test");

    const options = buildSentryOptions();

    expect(options).toMatchObject({
      dsn: "https://public@example.com/1",
      environment: "staging",
      release: "argus-web@test",
      sendDefaultPii: false,
    });
  });

  it("strips request headers, cookies, bodies, query strings and user data", () => {
    const event = {
      request: {
        method: "POST",
        url: "https://app.example/api?token=secret",
        headers: { Authorization: "Bearer secret" },
        cookies: { argus_session: "secret" },
        data: { note: "private" },
      },
      user: { email: "qa@example.com" },
      breadcrumbs: [{ message: "token secret" }],
      extra: { note_body: "private", safe: 1 },
    } as unknown as ErrorEvent;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed?.request).toEqual({
      method: "POST",
      url: "https://app.example/api",
    });
    expect(scrubbed).not.toHaveProperty("user");
    expect(scrubbed).not.toHaveProperty("breadcrumbs");
    expect(scrubbed?.extra).toEqual({ note_body: "[REDACTED]", safe: 1 });
  });

  it("removes configured secret values from exception messages", () => {
    const secret = "workspace-token-0123456789abcdef";
    vi.stubEnv("WORKSPACE_TOKEN", secret);

    const event = {
      message: `failed with ${secret}`,
      exception: {
        values: [{ type: "Error", value: `boom ${secret}` }],
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed?.message).toBe("failed with [REDACTED]");
    expect(scrubbed?.exception?.values?.[0]?.value).toBe("boom [REDACTED]");
  });
});
