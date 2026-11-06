#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  assertNonEmptyFile,
  databaseSecrets,
  decryptFile,
  encryptFile,
  latestBackups,
  loadBackupConfig,
  pruneBackups,
  redactSecrets,
  sendAlert,
  timestampFor,
} from "./lib.mjs";

const run = promisify(execFile);

async function countArchiveEntries(archivePath) {
  const { stdout } = await run("tar", ["-tzf", archivePath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split("\n").filter(Boolean).length;
}

async function verifyDatabaseDump(dumpPath) {
  const { stdout } = await run("pg_restore", ["--list", dumpPath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!stdout.trim()) {
    throw new Error("pg_restore --list returned no entries");
  }
  return stdout.split("\n").filter((line) => line && !line.startsWith(";")).length;
}

async function main() {
  const config = loadBackupConfig();
  const stamp = timestampFor();
  const workDir = await mkdtemp(path.join(tmpdir(), "argus-backup-"));

  try {
    const dumpPath = path.join(workDir, "argus.dump");
    const archivePath = path.join(workDir, "argus-assets.tar.gz");
    const dbBackup = path.join(config.backupDir, `argus-db-${stamp}.dump.enc`);
    const assetsBackup = path.join(
      config.backupDir,
      `argus-assets-${stamp}.tar.gz.enc`,
    );

    await run("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${dumpPath}`,
      config.databaseUrl,
    ]);

    await run("tar", [
      "-czf",
      archivePath,
      "--exclude=.tmp",
      "-C",
      config.storageRoot,
      ".",
    ]);

    await assertNonEmptyFile(dumpPath, "database dump");
    await assertNonEmptyFile(archivePath, "asset archive");

    const dumpEntries = await verifyDatabaseDump(dumpPath);
    const archiveEntries = await countArchiveEntries(archivePath);
    if (archiveEntries === 0) {
      throw new Error("asset archive contains no entries");
    }

    await encryptFile(dumpPath, dbBackup, config.encryptionKey);
    await encryptFile(archivePath, assetsBackup, config.encryptionKey);

    const dbBytes = await assertNonEmptyFile(dbBackup, "encrypted database dump");
    const assetsBytes = await assertNonEmptyFile(assetsBackup, "encrypted asset archive");

    // Re-open the encrypted database dump to prove it decrypts before the
    // retention pass can delete older copies.
    const checkDump = path.join(workDir, "check.dump");
    await decryptFile(dbBackup, checkDump, config.encryptionKey);
    await verifyDatabaseDump(checkDump);

    const deleted = await pruneBackups(
      config.backupDir,
      config.retentionDays,
    );

    const result = {
      status: "ok",
      timestamp: stamp,
      database: { file: dbBackup, bytes: dbBytes, entries: dumpEntries },
      assets: { file: assetsBackup, bytes: assetsBytes, entries: archiveEntries },
      retention_days: config.retentionDays,
      pruned: deleted.length,
    };

    await writeFile(
      path.join(config.backupDir, "last-success.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    await rm(path.join(config.backupDir, "last-failure.json"), {
      force: true,
    });

    console.log(JSON.stringify(result));
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  let backupDir = process.env.BACKUP_DIR;
  let webhook = process.env.ALERT_WEBHOOK_URL;
  let secrets = databaseSecrets(process.env.DATABASE_URL).concat(
    process.env.BACKUP_ENCRYPTION_KEY ?? "",
  );

  try {
    const config = loadBackupConfig();
    backupDir = config.backupDir;
    webhook = config.alertWebhookUrl;
    secrets = databaseSecrets(config.databaseUrl).concat(
      config.encryptionKey,
    );
  } catch {
    // Configuration itself failed; still emit an alert if a webhook is set.
  }

  const message = redactSecrets(rawMessage, secrets);

  if (backupDir) {
    await writeFile(
      path.join(backupDir, "last-failure.json"),
      `${JSON.stringify(
        { status: "failed", timestamp: new Date().toISOString(), error: message },
        null,
        2,
      )}\n`,
    ).catch(() => {});
  }

  await sendAlert(webhook ?? null, "ARGUS backup failed", { error: message });
  console.error(`ARGUS backup failed: ${message}`);
  process.exitCode = 1;
});
