import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { QueryResultRow } from "pg";

import { SESSION_COOKIE, verifySessionJwt } from "./auth-session";
import { query } from "./db";

export interface SessionUser {
  id: string;
  email: string;
  role: "qa" | "developer";
}

export interface DashboardSession {
  sessionId: string;
  user: SessionUser;
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  user_id: string;
  email: string;
  role: "qa" | "developer";
}

async function loadSession(
  token: string | null | undefined,
): Promise<DashboardSession | null> {
  if (!token) {
    return null;
  }

  const claims = await verifySessionJwt(token);
  if (!claims) {
    return null;
  }

  const result = await query<SessionRow>(
    `SELECT s.id AS session_id,
            s.expires_at,
            u.id AS user_id,
            u.email,
            u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.expires_at > now()`,
    [claims.sid],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  await query(
    `UPDATE sessions
        SET expires_at = now() + interval '7 days',
            last_seen_at = now()
      WHERE id = $1`,
    [claims.sid],
  );

  return {
    sessionId: row.session_id,
    user: { id: row.user_id, email: row.email, role: row.role },
  };
}

export async function getSession(): Promise<DashboardSession | null> {
  const store = await cookies();
  return loadSession(store.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<DashboardSession> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Session check for API routes that already have the Request object.
 * Reads the dashboard cookie and resolves it to a user/role.
 */
export async function getRequestSession(
  request: Request,
): Promise<DashboardSession | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)argus_session=([^;]+)/);
  if (!match) {
    return null;
  }

  return loadSession(decodeURIComponent(match[1]));
}

/**
 * Session check for API routes that already have the Request object.
 * Used by the finalize route to allow an authenticated dashboard user
 * in place of a draft token.
 */
export async function hasDashboardSession(
  request: Request,
): Promise<boolean> {
  return Boolean(await getRequestSession(request));
}
