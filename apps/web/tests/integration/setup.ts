import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function deriveTestUrl(baseUrl: string | undefined): string {
  if (!baseUrl) {
    throw new Error(
      "DATABASE_URL or TEST_DATABASE_URL is required for integration tests.",
    );
  }
  const url = new URL(baseUrl);
  url.pathname = "/argus_test";
  return url.toString();
}

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? deriveTestUrl(process.env.DATABASE_URL);
