#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  databaseSecrets,
  decryptFile,
  latestBackups,
  loadBackupConfig,
  redactSecrets,
  sendAlert,
} from "./lib.mjs";

const run = promisify(execFile);

async function main() {
  const config = loadBackupConfig();
  const { db, assets } = await latestBackups(config.backupDir);

  if (!db || !assets) {
    throw new Error(
      `No backup pair found in ${config.backupDir} (db=${Boolean(db)}, assets=${Boolean(assets)})`,
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "argus-verify-"));

  try {
    const dumpPath = path.join(workDir, "latest.dump");
    const archivePath = path.join(workDir, "latest.tar.gz");

    await decryptFile(db.path, dumpPath, config.encryptionKey);
    await decryptFile(assets.path, archivePath, config.encryptionKey);

    const { stdout: dumpList } = await run("pg_restore", ["--list", dumpPath], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const dumpEntries = dumpList
      .split("\n")
      .filter((line) => line && !line.startsWith(";")).length;
    if (dumpEntries === 0) {
      throw new Error("latest database dump has no restorable entries");
    }

    const { stdout: archiveList } = await run("tar", ["-tzf", archivePath], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const archiveEntries = archiveList.split("\n").filter(Boolean).length;
    if (archiveEntries === 0) {
      throw new Error("latest asset archive contains no entries");
    }

    const result = {
      status: "ok",
      database: { file: db.name, entries: dumpEntries },
      assets: { file: assets.name, entries: archiveEntries },
      checked_at: new Date().toISOString(),
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(
    rawMessage,
    databaseSecrets(process.env.DATABASE_URL).concat(
      process.env.BACKUP_ENCRYPTION_KEY ?? "",
    ),
  );
  await sendAlert(
    process.env.ALERT_WEBHOOK_URL?.trim() || null,
    "ARGUS backup verification failed",
    { error: message },
  );
  console.error(`ARGUS backup verification failed: ${message}`);
  process.exitCode = 1;
});
