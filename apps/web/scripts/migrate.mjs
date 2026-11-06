import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runner } from "node-pg-migrate";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const envPath = path.join(appDir, ".env.local");

if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const direction = process.argv[2] ?? "up";
if (direction !== "up" && direction !== "down") {
  console.error("Usage: node scripts/migrate.mjs <up|down> [count]");
  process.exit(1);
}

const rawCount = process.argv[3];
let count;
if (rawCount !== undefined) {
  count = Number.parseInt(rawCount, 10);
  if (!Number.isInteger(count) || count < 1) {
    console.error("count must be a positive integer");
    process.exit(1);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Add it to apps/web/.env.local or export it in CI.",
  );
  process.exit(1);
}

await runner({
  databaseUrl,
  dir: path.join(appDir, "migrations"),
  direction,
  count,
  migrationsTable: "pgmigrations",
  checkOrder: true,
  verbose: true,
});
