import { existsSync } from "node:fs";

import { closePool, query } from "../src/lib/db";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const REQUIRED_TABLES = [
  "projects",
  "issues",
  "issue_reconsider_notes",
  "issue_supplementary_assets",
] as const;

const REQUIRED_INDEXES = [
  "idx_project_issue_number",
  "idx_issues_status",
  "idx_issues_project_status",
  "idx_reconsider_issue",
] as const;

const REQUIRED_FOREIGN_KEYS = [
  { table: "issues", column: "project_id", referencedTable: "projects" },
  {
    table: "issue_reconsider_notes",
    column: "issue_id",
    referencedTable: "issues",
  },
  {
    table: "issue_supplementary_assets",
    column: "issue_id",
    referencedTable: "issues",
  },
] as const;

interface TableRow {
  table_name: string;
}

interface IndexRow {
  indexname: string;
}

interface ForeignKeyRow {
  table_name: string;
  column_name: string;
  referenced_table: string;
  delete_rule: string;
}

async function main() {
  const tables = await query<TableRow>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[...REQUIRED_TABLES]],
  );

  const indexes = await query<IndexRow>(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])`,
    [[...REQUIRED_INDEXES]],
  );

  const foreignKeys = await query<ForeignKeyRow>(
    `SELECT tc.table_name,
            kcu.column_name,
            ccu.table_name AS referenced_table,
            rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'`,
  );

  const failures: string[] = [];
  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  const foundIndexes = new Set(indexes.rows.map((row) => row.indexname));

  for (const table of REQUIRED_TABLES) {
    if (!foundTables.has(table)) {
      failures.push(`missing table: ${table}`);
    }
  }

  for (const index of REQUIRED_INDEXES) {
    if (!foundIndexes.has(index)) {
      failures.push(`missing index: ${index}`);
    }
  }

  for (const required of REQUIRED_FOREIGN_KEYS) {
    const match = foreignKeys.rows.find(
      (row) =>
        row.table_name === required.table &&
        row.column_name === required.column &&
        row.referenced_table === required.referencedTable,
    );

    if (!match) {
      failures.push(
        `missing foreign key: ${required.table}.${required.column} -> ${required.referencedTable}`,
      );
    } else if (match.delete_rule !== "CASCADE") {
      failures.push(
        `foreign key ${required.table}.${required.column} must use ON DELETE CASCADE (found ${match.delete_rule})`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("Schema verification failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Schema verification passed: ${REQUIRED_TABLES.length} tables, ` +
      `${REQUIRED_FOREIGN_KEYS.length} foreign keys, ${REQUIRED_INDEXES.length} indexes.`,
  );
}

main()
  .catch((error) => {
    console.error(
      "Schema verification failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
