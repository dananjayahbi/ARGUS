import { existsSync } from "node:fs";

import { closePool, query } from "../src/lib/db";
import type { ProjectRow } from "../src/lib/db-types";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const DEFAULT_PROJECT = {
  name: "ARGUS",
  key: "ARG",
  description: "ARGUS QA capture and bug tracking workspace.",
};

async function main() {
  const inserted = await query<ProjectRow>(
    `INSERT INTO projects (name, key, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO NOTHING
     RETURNING *`,
    [DEFAULT_PROJECT.name, DEFAULT_PROJECT.key, DEFAULT_PROJECT.description],
  );

  const existing = await query<ProjectRow>(
    "SELECT * FROM projects WHERE key = $1",
    [DEFAULT_PROJECT.key],
  );

  if (existing.rowCount !== 1) {
    throw new Error(
      `Expected exactly one project with key ${DEFAULT_PROJECT.key}, found ${existing.rowCount ?? 0}.`,
    );
  }

  console.log(
    inserted.rowCount === 1
      ? `Inserted default project ${DEFAULT_PROJECT.name} (${DEFAULT_PROJECT.key}).`
      : `Default project ${DEFAULT_PROJECT.name} (${DEFAULT_PROJECT.key}) already exists.`,
  );
  console.log(`Verified exactly one project with key ${DEFAULT_PROJECT.key}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
