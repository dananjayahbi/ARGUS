import { z } from "zod";

function requiredString(name: string, minLength = 1) {
  return z.preprocess(
    (value) => (value === undefined || value === null ? "" : value),
    z
      .string()
      .min(1, `${name} is required`)
      .refine(
        (value) => value.length >= minLength,
        `${name} must be at least ${minLength} characters`,
      ),
  );
}

const PLACEHOLDER_MARKERS = [
  "replace-with",
  "changeme",
  "change-me",
  "your-secret",
  "your-token",
  "example-secret",
  "example-token",
];

/**
 * Reject obvious placeholders and low-entropy strings such as "x".repeat(32).
 * This is a startup guard, not a password-strength meter.
 */
export function isWeakSecretValue(value: string): boolean {
  const normalized = value.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }

  return new Set(value).size < 8;
}

function secretString(name: string, minLength = 32) {
  return requiredString(name, minLength).refine(
    (value) => !isWeakSecretValue(value),
    `${name} must be a high-entropy secret, not a placeholder or repeated pattern`,
  );
}

function absoluteUrl(name: string) {
  return z.preprocess(
    (value) => (value === undefined || value === null ? "" : value),
    z
      .string()
      .min(1, `${name} is required`)
      .refine((value) => {
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      }, `${name} must be an absolute URL`),
  );
}

const envSchema = z.object({
  DATABASE_URL: absoluteUrl("DATABASE_URL"),
  WORKSPACE_TOKEN: secretString("WORKSPACE_TOKEN", 32),
  DRAFT_TOKEN_SECRET: secretString("DRAFT_TOKEN_SECRET", 32),
  CDN_AUTH_TOKEN: secretString("CDN_AUTH_TOKEN", 32),
  CDN_BASE_URL: absoluteUrl("CDN_BASE_URL").transform((value) =>
    value.replace(/\/+$/, ""),
  ),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export class EnvironmentError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        "Invalid ARGUS environment configuration:",
        ...issues.map((issue) => `  - ${issue}`),
        "Add the missing values to apps/web/.env.local (see apps/web/.env.example).",
      ].join("\n"),
    );
    this.name = "EnvironmentError";
    this.issues = issues;
  }
}

let cached: Env | undefined;

/**
 * Parse and cache the server environment. Throws EnvironmentError listing
 * every invalid or missing variable so startup failures are actionable.
 */
export function getEnv(): Env {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const byField = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "environment";
      if (!byField.has(field)) {
        byField.set(field, `${field}: ${issue.message}`);
      }
    }
    throw new EnvironmentError([...byField.values()]);
  }

  cached = parsed.data;
  return cached;
}

/** Test helper: clear the cached environment so the next call re-parses. */
export function resetEnvCache(): void {
  cached = undefined;
}
