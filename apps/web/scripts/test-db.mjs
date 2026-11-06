import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runner } from "node-pg-migrate";
import { Client, Pool } from "pg";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(appDir, ".env.local");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

function deriveTestUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = "/argus_test";
  return url.toString();
}

const testUrl =
  process.env.TEST_DATABASE_URL ??
  (process.env.DATABASE_URL
    ? deriveTestUrl(process.env.DATABASE_URL)
    : undefined);

if (!testUrl) {
  console.error("Set TEST_DATABASE_URL or DATABASE_URL before running this script.");
  process.exit(1);
}

const command = process.argv[2] ?? "setup";

async function ensureDatabase() {
  const parsed = new URL(testUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = "/postgres";

  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (existing.rowCount === 0) {
      await client.query(
        `CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`,
      );
      console.log(`Created test database ${databaseName}.`);
    }
  } finally {
    await client.end();
  }
}

async function migrateAndSeed() {
  await runner({
    databaseUrl: testUrl,
    dir: path.join(appDir, "migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    verbose: false,
  });

  const pool = new Pool({ connectionString: testUrl });
  try {
    await pool.query(
      `INSERT INTO projects (name, key, description)
       VALUES ('ARGUS', 'ARG', 'Integration test workspace')
       ON CONFLICT (key) DO NOTHING`,
    );
  } finally {
    await pool.end();
  }
}

async function resetIssues() {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await pool.query(
      `TRUNCATE TABLE issue_supplementary_assets,
                       issue_reconsider_notes,
                       issues
       RESTART IDENTITY CASCADE`,
    );
  } finally {
    await pool.end();
  }
}

if (command === "setup") {
  await ensureDatabase();
  await migrateAndSeed();
  console.log("Integration database is migrated and seeded.");
} else if (command === "reset") {
  await resetIssues();
  console.log("Integration issue tables truncated.");
} else {
  console.error("Usage: node scripts/test-db.mjs <setup|reset>");
  process.exit(1);
}
