import { z } from "zod";

const authEnvSchema = z.object({
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  QA_EMAIL: z.string().email("QA_EMAIL must be a valid email"),
  QA_PASSWORD: z
    .string()
    .min(8, "QA_PASSWORD must be at least 8 characters"),
  DEVELOPER_EMAIL: z
    .string()
    .email("DEVELOPER_EMAIL must be a valid email"),
  DEVELOPER_PASSWORD: z
    .string()
    .min(8, "DEVELOPER_PASSWORD must be at least 8 characters"),
});

export type AuthConfig = z.infer<typeof authEnvSchema>;

let cached: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cached) {
    return cached;
  }

  const parsed = authEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    );
    throw new Error(
      `Invalid ARGUS auth configuration:\n${issues.join("\n")}`,
    );
  }

  cached = parsed.data;
  return cached;
}

export function resetAuthConfigCache(): void {
  cached = null;
}
