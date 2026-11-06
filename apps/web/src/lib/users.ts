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
    const existing = await query("SELECT id FROM users WHERE email = $1", [
      account.email,
    ]);
    if (existing.rowCount === 0) {
      const passwordHash = await hash(account.password);
      await query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [account.email, passwordHash, account.role],
      );
    }
  }
}

export async function authenticate(
  email: string,
  password: string,
): Promise<UserRow | null> {
  await ensureSeedUsers();

  const result = await query<UserRow>(
    "SELECT id, email, password_hash, role FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  const user = result.rows[0];
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
