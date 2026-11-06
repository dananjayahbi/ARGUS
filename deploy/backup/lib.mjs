import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const MAGIC = Buffer.from("ARGBK1", "ascii");
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const BACKUP_NAME_PATTERN =
  /^argus-(db|assets)-(\d{8}T\d{6}Z)\.(dump|tar\.gz)\.enc$/;

export function loadBackupConfig(env = process.env) {
  const required = [
    "DATABASE_URL",
    "CDN_STORAGE_ROOT",
    "BACKUP_DIR",
    "BACKUP_ENCRYPTION_KEY",
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing backup configuration: ${missing.join(", ")}`);
  }

  if (env.BACKUP_ENCRYPTION_KEY.trim().length < 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be at least 32 characters");
  }

  const retentionDays = Number(env.BACKUP_RETENTION_DAYS ?? "14");
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("BACKUP_RETENTION_DAYS must be a positive integer");
  }

  return {
    databaseUrl: env.DATABASE_URL,
    storageRoot: path.resolve(env.CDN_STORAGE_ROOT),
    backupDir: path.resolve(env.BACKUP_DIR),
    encryptionKey: env.BACKUP_ENCRYPTION_KEY,
    retentionDays,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL?.trim() || null,
  };
}

export function timestampFor(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function keyFor(secret, salt) {
  return scryptSync(secret, salt, 32);
}

export async function encryptFile(inputPath, outputPath, secret) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, salt), iv);

  const handle = await open(outputPath, "w");
  try {
    await handle.write(MAGIC);
    await handle.write(salt);
    await handle.write(iv);
    const tagPosition = (await handle.stat()).size;
    await handle.write(Buffer.alloc(TAG_BYTES));
    await handle.close();

    await pipeline(
      createReadStream(inputPath),
      cipher,
      createWriteStream(outputPath, { flags: "a" }),
    );

    const tag = cipher.getAuthTag();
    const finalHandle = await open(outputPath, "r+");
    try {
      await finalHandle.write(tag, 0, TAG_BYTES, tagPosition);
    } finally {
      await finalHandle.close();
    }
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function decryptFile(inputPath, outputPath, secret) {
  const handle = await open(inputPath, "r");
  let header;
  try {
    header = Buffer.alloc(MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES);
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not an ARGUS backup file");
  }

  let offset = MAGIC.length;
  const salt = header.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = header.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = header.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;

  const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, salt), iv);
  decipher.setAuthTag(tag);

  await pipeline(
    createReadStream(inputPath, { start: offset }),
    decipher,
    createWriteStream(outputPath),
  );
}

export async function listBackups(backupDir) {
  await mkdir(backupDir, { recursive: true });
  const entries = await readdir(backupDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && BACKUP_NAME_PATTERN.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(BACKUP_NAME_PATTERN);
      return {
        name: entry.name,
        kind: match[1],
        timestamp: match[2],
        path: path.join(backupDir, entry.name),
      };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function parseBackupTimestamp(value) {
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(
    9,
    11,
  )}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return Date.parse(iso);
}

/**
 * Delete only ARGUS backup files whose filename timestamp is older than the
 * retention window. Unrelated files are never touched.
 */
export async function pruneBackups(
  backupDir,
  retentionDays,
  now = Date.now(),
) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const deleted = [];

  for (const backup of await listBackups(backupDir)) {
    const created = parseBackupTimestamp(backup.timestamp);
    if (Number.isFinite(created) && created < cutoff) {
      await unlink(backup.path);
      deleted.push(backup.path);
    }
  }

  return deleted;
}

export async function latestBackups(backupDir) {
  const backups = await listBackups(backupDir);
  const db = [...backups].reverse().find((entry) => entry.kind === "db");
  const assets = [...backups].reverse().find((entry) => entry.kind === "assets");
  return { db, assets };
}

export async function sendAlert(webhookUrl, message, details = {}) {
  const payload = { text: message, details };

  if (!webhookUrl) {
    console.error(`ALERT: ${message} ${JSON.stringify(details)}`);
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`ALERT delivery failed: ${response.status} ${message}`);
    }
    return response.ok;
  } catch (error) {
    console.error(
      `ALERT delivery failed: ${error instanceof Error ? error.message : error}`,
    );
    return false;
  }
}

export async function assertNonEmptyFile(filePath, label) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`${label} is missing or empty: ${filePath}`);
  }
  return info.size;
}

export function redactSecrets(value, secrets = []) {
  let output = String(value);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      output = output.split(secret).join("[REDACTED]");
    }
  }
  return output;
}

export function databaseSecrets(databaseUrl) {
  if (!databaseUrl) {
    return [];
  }
  try {
    const url = new URL(databaseUrl);
    return [databaseUrl, decodeURIComponent(url.password)].filter(Boolean);
  } catch {
    return [databaseUrl];
  }
}
