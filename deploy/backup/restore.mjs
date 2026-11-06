#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { databaseSecrets, decryptFile, latestBackups, redactSecrets } from "./lib.mjs";

const run = promisify(execFile);

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const targetDatabaseUrl = argValue("database-url") ?? process.env.RESTORE_DATABASE_URL;
  const targetStorage = argValue("storage-dir") ?? process.env.RESTORE_STORAGE_DIR;
  const backupDir = process.env.BACKUP_DIR;
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

  if (!targetDatabaseUrl || !targetStorage) {
    throw new Error(
      "Usage: node restore.mjs --database-url <scratch-db-url> --storage-dir <target-dir>",
    );
  }
  if (!backupDir || !encryptionKey) {
    throw new Error("BACKUP_DIR and BACKUP_ENCRYPTION_KEY are required");
  }

  const latest = await latestBackups(backupDir);
  const dbFile = argValue("db-file")
    ? path.resolve(argValue("db-file"))
    : latest.db?.path;
  const assetsFile = argValue("assets-file")
    ? path.resolve(argValue("assets-file"))
    : latest.assets?.path;

  if (!dbFile || !assetsFile) {
    throw new Error(`No backup pair found in ${backupDir}`);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "argus-restore-"));

  try {
    const dumpPath = path.join(workDir, "restore.dump");
    const archivePath = path.join(workDir, "restore.tar.gz");

    await decryptFile(dbFile, dumpPath, encryptionKey);
    await decryptFile(assetsFile, archivePath, encryptionKey);

    try {
      await run("pg_restore", [
        "--no-owner",
        "--no-privileges",
        `--dbname=${targetDatabaseUrl}`,
        dumpPath,
      ]);
    } catch (error) {
      // pg_dump 18 emits SET transaction_timeout = 0, which PostgreSQL 12
      // rejects. The data still restores; only that header statement fails.
      const stderr = String(error.stderr ?? "");
      const realErrors = stderr
        .split(/\r?\n/)
        .filter((line) => line.includes("ERROR:"))
        .filter(
          (line) =>
            !line.includes(
              'unrecognized configuration parameter "transaction_timeout"',
            ),
        );
      if (realErrors.length > 0 || stderr.includes("FATAL:")) {
        throw error;
      }
      console.error(
        "pg_restore warning: ignored PostgreSQL client/server transaction_timeout skew",
      );
    }

    await mkdir(targetStorage, { recursive: true });
    await run("tar", ["-xzf", archivePath, "-C", targetStorage]);

    const { stdout } = await run("psql", [
      targetDatabaseUrl,
      "-tAc",
      "select count(*) from issues",
    ]);
    const issueCount = Number(stdout.trim());

    const result = {
      status: "ok",
      restored_at: new Date().toISOString(),
      database: { source: dbFile, issues: issueCount },
      assets: { source: assetsFile, target: path.resolve(targetStorage) },
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(
    rawMessage,
    databaseSecrets(process.env.DATABASE_URL).concat(
      process.env.BACKUP_ENCRYPTION_KEY ?? "",
    ),
  );
  console.error(`ARGUS restore failed: ${message}`);
  process.exitCode = 1;
});
