import type { ErrorEvent } from "@sentry/nextjs";

const SENSITIVE_KEY =
  /(token|secret|password|authorization|cookie|note|body|dsn|database_url|api[_-]?key)/i;

function configuredSecrets(): string[] {
  return Object.entries(process.env)
    .filter(
      ([key, value]) =>
        typeof value === "string" &&
        value.length >= 8 &&
        (key === "DATABASE_URL" ||
          /(_TOKEN|_SECRET|_PASSWORD|_KEY)$/.test(key)),
    )
    .map(([, value]) => value as string);
}

function scrubText(value: string | undefined, secrets: string[]): string | undefined {
  if (!value) {
    return value;
  }

  let output = value;
  for (const secret of secrets) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("?")[0];
  }
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  const secrets = configuredSecrets();

  if (event.request) {
    event.request = {
      method: event.request.method,
      url: stripQuery(event.request.url),
    };
  }

  delete event.user;
  delete event.breadcrumbs;

  if (event.message) {
    event.message = scrubText(event.message, secrets);
  }

  if (event.logentry?.message) {
    event.logentry.message = scrubText(event.logentry.message, secrets) ?? "";
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value) => ({
      ...value,
      value: scrubText(value.value, secrets),
    }));
  }

  if (event.extra) {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.extra)) {
      scrubbed[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : value;
    }
    event.extra = scrubbed;
  }

  return event;
}

export function buildSentryOptions() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return null;
  }

  return {
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      "development",
    release:
      process.env.SENTRY_RELEASE ??
      process.env.npm_package_version ??
      "argus-web@0.1.0",
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0",
    ),
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  };
}
