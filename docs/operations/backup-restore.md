# Backup and restore

- **Status:** Active
- **Retention window:** 14 days (configurable with `BACKUP_RETENTION_DAYS`)
- **Schedule:** daily at 02:30 host time, with a 15-minute randomized delay
- **Encryption:** AES-256-GCM, key derived with scrypt from
  `BACKUP_ENCRYPTION_KEY`
- **Destination:** `BACKUP_DIR`, which must be an off-box mount

## 1. What is backed up

| Artifact | Source | File |
| --- | --- | --- |
| PostgreSQL | `pg_dump --format=custom` | `argus-db-<UTC>.dump.enc` |
| CDN assets | `tar -czf` of `CDN_STORAGE_ROOT` (excluding `.tmp`) | `argus-assets-<UTC>.tar.gz.enc` |

Both files are encrypted at rest before they are written to `BACKUP_DIR`.
`last-success.json` and `last-failure.json` record the most recent outcome.

The database dump uses the custom format so `pg_restore --list` can prove it is
readable without a live database. The asset archive must contain at least one
entry, otherwise the backup fails.

## 2. Off-box requirement

`BACKUP_DIR` must not be the same physical device as the database or the CDN
storage. Supported options:

- an NFS/SMB mount from a NAS or another host;
- an SSHFS/rclone mount to remote storage;
- a USB disk that is physically separate and removed after each run.

A single disk failure must not destroy both the live data and every copy.
The script validates that `BACKUP_DIR` exists but cannot prove it is off-box;
the operator records the mount in the rollout ticket.

## 3. Setup on the Mini PC

```bash
sudo install -d -m 700 /etc/argus
sudo install -m 600 -o root -g root \
  deploy/backup/backup.env.example /etc/argus/backup.env
sudoedit /etc/argus/backup.env   # DATABASE_URL, storage root, off-box dir, key

sudo install -m 644 deploy/backup/argus-backup.service /etc/systemd/system/
sudo install -m 644 deploy/backup/argus-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now argus-backup.timer

# Run once immediately and inspect the result:
sudo systemctl start argus-backup.service
sudo systemctl status argus-backup.service
sudo cat "$BACKUP_DIR/last-success.json"
```

`backup.env` contains the database URL, encryption key and webhook URL. It is
mode 600 and never committed. The service runs as the unprivileged `argus` user
with `ProtectSystem=strict` and write access only to the off-box mount and the
CDN storage tree.

## 4. Retention

`backup.mjs` calls `pruneBackups(BACKUP_DIR, BACKUP_RETENTION_DAYS)` after a
successful backup and verification. It deletes **only** files matching:

```
argus-db-YYYYMMDDTHHMMSSZ.dump.enc
argus-assets-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

whose filename timestamp is older than the retention window. Unrelated files
and recent backups are never touched. The default window is 14 days.

## 5. Integrity verification

`verify.mjs` (also run as `ExecStartPost`) decrypts the latest pair and:

1. runs `pg_restore --list` and requires at least one restorable entry;
2. runs `tar -tzf` and requires a non-zero entry count.

Run it manually at any time:

```bash
sudo -u argus env $(cat /etc/argus/backup.env | xargs) \
  node /opt/argus/deploy/backup/verify.mjs
```

## 6. Restore procedure

Always restore into a **scratch** database and directory first. Never point the
restore command at the live database.

```bash
# 1. Create an empty scratch database.
createdb -h 127.0.0.1 -U argus argus_restore_drill

# 2. Restore the latest encrypted pair.
export BACKUP_DIR=/mnt/offbox/argus-backups
export BACKUP_ENCRYPTION_KEY=...            # from /etc/argus/backup.env
node deploy/backup/restore.mjs \
  --database-url postgresql://argus:...@127.0.0.1:5432/argus_restore_drill \
  --storage-dir /tmp/argus-restore-drill

# 3. Compare counts and spot-check an asset.
psql postgresql://argus:...@127.0.0.1:5432/argus_restore_drill \
  -c "select count(*) from issues;"
find /tmp/argus-restore-drill -type f | head
```

If the drill is good, stop the live services, restore into the real database
and storage root, then start the services:

```bash
sudo systemctl stop argus-web argus-cdn
node deploy/backup/restore.mjs \
  --database-url "$DATABASE_URL" \
  --storage-dir "$CDN_STORAGE_ROOT"
sudo systemctl start argus-cdn argus-web
```

The restore script tolerates the known PostgreSQL 18 client → PostgreSQL 12
server `transaction_timeout` header skew; any other `ERROR:`/`FATAL:` aborts
the restore before assets are extracted.

## 7. Alerting

On any failure (missing configuration, `pg_dump` error, empty dump/archive,
retention error, verification failure) the script:

1. writes `last-failure.json` in `BACKUP_DIR`;
2. posts `{ "text": "ARGUS backup failed", "details": { "error": ... } }` to
   `ALERT_WEBHOOK_URL` when set;
3. prints the sanitized error to stderr and exits non-zero.

Database URLs, passwords and the encryption key are replaced with
`[REDACTED]` before the alert, the failure file or stderr is written.

## 8. Restore drill record

| Date (UTC) | Operator | Backup | Verify | Restore target | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-11-06 18:00 | Agent-Copilot | `argus-db-20261106T180056Z.dump.enc` (18,255 B, 45 entries) and `argus-assets-20261106T180056Z.tar.gz.enc` (4,538 B, 14 entries) | `pg_restore --list` 45 entries; `tar -tzf` 14 entries | `argus_restore_drill` + temp storage dir | PASS: source/restored issues 1, projects 1; restored asset `raw/2026/11/drill-asset.png` 13,155 B |

A negative drill was also run with an unreachable database and a local webhook:
the script exited 1, delivered exactly one alert, and the alert text contained
`[REDACTED]` instead of the database URL/password.
