import { hash, verify } from "@node-rs/argon2";
import type { QueryResultRow } from "pg";

import { getAuthConfig } from "./auth-config";
import { query } from "./db";

export type UserRole = "qa" | "developer";

export interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
}

let seedPromise: Promise<void> | null = null;

export async function ensureSeedUsers(): Promise<void> {
  seedPromise ??= seedUsers();
  return seedPromise;
}

async function seedUsers(): Promise<void> {
  const config = getAuthConfig();
  const accounts: Array<{
    email: string;
    password: string;
    role: UserRole;
  }> = [
    {
      email: config.QA_EMAIL.toLowerCase(),
      password: config.QA_PASSWORD,
      role: "qa",
    },
    {
      email: config.DEVELOPER_EMAIL.toLowerCase(),
      password: config.DEVELOPER_PASSWORD,
      role: "developer",
    },
  ];

  for (const account of accounts) {
    const existing = await query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [account.email],
    );
    if (existing.rowCount === 0) {
      const passwordHash = await hash(account.password);
      await query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [account.email, passwordHash, account.role],
      );
      continue;
    }

    // Keep the stored hash in sync with the configured password so rotating
    // QA_PASSWORD / DEVELOPER_PASSWORD actually updates the existing account.
    const user = existing.rows[0];
    let matches = false;
    try {
      matches = await verify(user.password_hash, account.password);
    } catch {
      matches = false;
    }
    if (!matches) {
      const passwordHash = await hash(account.password);
      await query(
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [passwordHash, user.id],
      );
    }
  }
}

export async function authenticate(
  identifier: string,
  password: string,
): Promise<UserRow | null> {
  await ensureSeedUsers();

  const normalized = identifier.trim().toLowerCase();
  const result = await query<UserRow>(
    `SELECT id, email, password_hash, role
     FROM users
     WHERE lower(email) = $1 OR lower(split_part(email, '@', 1)) = $1
     ORDER BY (lower(email) = $1) DESC
     LIMIT 2`,
    [normalized],
  );
  // A short username that matches more than one account is ambiguous and must
  // not sign in as an arbitrary user.
  const user = result.rowCount === 1 ? result.rows[0] : undefined;
  if (!user) {
    return null;
  }

  try {
    const valid = await verify(user.password_hash, password);
    return valid ? user : null;
  } catch {
    return null;
  }
}
