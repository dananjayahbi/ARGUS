import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNonEmptyFile,
  databaseSecrets,
  decryptFile,
  encryptFile,
  loadBackupConfig,
  pruneBackups,
  redactSecrets,
  sendAlert,
  timestampFor,
} from "./lib.mjs";

const KEY = "backup-encryption-key-0123456789abcdef";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "argus-backup-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("encryption round-trips a binary payload", async () => {
  await withTempDir(async (dir) => {
    const source = path.join(dir, "source.bin");
    const encrypted = path.join(dir, "source.bin.enc");
    const restored = path.join(dir, "restored.bin");
    const payload = Buffer.from("argus backup payload \u0000\u0001\u0002", "utf8");
    await writeFile(source, payload);

    await encryptFile(source, encrypted, KEY);
    const encryptedBytes = await readFile(encrypted);
    assert.equal(encryptedBytes.subarray(0, 6).toString("ascii"), "ARGBK1");
    assert.equal(encryptedBytes.includes(payload), false);

    await decryptFile(encrypted, restored, KEY);
    assert.deepEqual(await readFile(restored), payload);
  });
});

test("a wrong key fails authentication", async () => {
  await withTempDir(async (dir) => {
    const source = path.join(dir, "source.bin");
    const encrypted = path.join(dir, "source.bin.enc");
    const restored = path.join(dir, "restored.bin");
    await writeFile(source, "payload");

    await encryptFile(source, encrypted, KEY);
    await assert.rejects(
      decryptFile(encrypted, restored, "another-key-0123456789abcdef"),
    );
  });
});

test("retention deletes only old, correctly named backups", async () => {
  await withTempDir(async (dir) => {
    const names = [
      "argus-db-20200101T000000Z.dump.enc",
      "argus-assets-20200101T000000Z.tar.gz.enc",
      "argus-db-20990101T000000Z.dump.enc",
      "unrelated.txt",
      "argus-db-notatimestamp.dump.enc",
    ];
    for (const name of names) {
      await writeFile(path.join(dir, name), "x");
    }

    const deleted = await pruneBackups(
      dir,
      14,
      Date.parse("2026-01-15T00:00:00Z"),
    );

    assert.deepEqual(
      deleted.map((file) => path.basename(file)).sort(),
      [
        "argus-assets-20200101T000000Z.tar.gz.enc",
        "argus-db-20200101T000000Z.dump.enc",
      ],
    );

    const remaining = await readFile(path.join(dir, "unrelated.txt"), "utf8");
    assert.equal(remaining, "x");
  });
});

test("configuration rejects missing and weak values", () => {
  const base = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    CDN_STORAGE_ROOT: "./storage",
    BACKUP_DIR: "./backups",
    BACKUP_ENCRYPTION_KEY: KEY,
    BACKUP_RETENTION_DAYS: "14",
  };

  assert.equal(loadBackupConfig(base).retentionDays, 14);

  assert.throws(
    () => loadBackupConfig({ ...base, BACKUP_DIR: "" }),
    /Missing backup configuration: BACKUP_DIR/,
  );
  assert.throws(
    () => loadBackupConfig({ ...base, BACKUP_ENCRYPTION_KEY: "short" }),
    /at least 32/,
  );
  assert.throws(
    () => loadBackupConfig({ ...base, BACKUP_RETENTION_DAYS: "0" }),
    /positive integer/,
  );
});

test("empty files are rejected", async () => {
  await withTempDir(async (dir) => {
    const empty = path.join(dir, "empty");
    await writeFile(empty, "");
    await assert.rejects(assertNonEmptyFile(empty, "dump"), /missing or empty/);
  });
});

test("alerts are posted to the configured webhook", async () => {
  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push(JSON.parse(body));
      response.writeHead(204);
      response.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/hook`;

  try {
    const delivered = await sendAlert(url, "ARGUS backup failed", {
      error: "disk full",
    });
    assert.equal(delivered, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].text, "ARGUS backup failed");
    assert.equal(received[0].details.error, "disk full");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("timestamps use the compact UTC backup format", () => {
  assert.equal(
    timestampFor(new Date("2026-11-06T17:42:57.658Z")),
    "20261106T174257Z",
  );
});

test("alert text redacts the database URL and encryption key", () => {
  const url = "postgresql://postgres:Indusara2@db.example:5432/qa-db";
  const key = "backup-encryption-key-0123456789abcdef";
  const message = `Command failed: pg_dump ${url} ${key}`;

  const redacted = redactSecrets(message, [
    ...databaseSecrets(url),
    key,
  ]);

  assert.equal(redacted.includes("Indusara2"), false);
  assert.equal(redacted.includes(url), false);
  assert.equal(redacted.includes(key), false);
  assert.match(redacted, /\[REDACTED\]/);
});
