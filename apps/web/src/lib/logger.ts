type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY =
  /(token|secret|password|authorization|cookie|note|body|dsn|database_url|api[_-]?key)/i;

const SENSITIVE_VALUE =
  /(bearer\s+[a-z0-9._-]+|argus_session=|x-workspace-token|x-cdn-auth-token)/gi;

function redactString(value: string): string {
  return value.replace(SENSITIVE_VALUE, "[REDACTED]");
}

/**
 * Recursively redact values whose key looks sensitive. This is a defence in
 * depth measure: callers should still never pass tokens, note bodies or
 * request bodies into the logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[TRUNCATED]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redact(item, depth + 1);
    }
    return output;
  }

  return value;
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "web",
    event,
    ...(redact(fields) as Record<string, unknown>),
  });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logRequest(fields: {
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
}): void {
  logEvent("info", "request", fields);
}
