import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import type { AuthorRole } from "@/lib/db-types";
import { withApiObservability } from "@/lib/observability";
import { getRequestSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NotificationRow extends QueryResultRow {
  id: string;
  issue_id: string;
  comment_id: string | null;
  actor_role: AuthorRole;
  actor_email: string | null;
  read_at: Date | null;
  created_at: Date;
  issue_number: number;
  issue_title: string;
  project_key: string;
  project_name: string;
  comment_body: string | null;
  comment_author_role: AuthorRole | null;
}

interface UnreadRow extends QueryResultRow {
  count: number;
}

async function handleGET(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  const [notificationsResult, unreadResult] = await Promise.all([
    query<NotificationRow>(
      `SELECT n.id,
              n.issue_id,
              n.comment_id,
              n.actor_role,
              n.read_at,
              n.created_at,
              i.issue_number,
              i.title AS issue_title,
              p.key AS project_key,
              p.name AS project_name,
              c.body AS comment_body,
              c.author_role AS comment_author_role,
              u.email AS actor_email
         FROM notifications n
         JOIN issues i ON i.id = n.issue_id
         JOIN projects p ON p.id = i.project_id
         LEFT JOIN issue_comments c ON c.id = n.comment_id
         LEFT JOIN users u ON u.id = n.actor_user_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 100`,
      [session.user.id],
    ),
    query<UnreadRow>(
      `SELECT count(*)::int AS count
         FROM notifications
        WHERE user_id = $1
          AND read_at IS NULL`,
      [session.user.id],
    ),
  ]);

  return NextResponse.json({
    notifications: notificationsResult.rows.map((row) => ({
      id: row.id,
      issue_id: row.issue_id,
      comment_id: row.comment_id,
      actor_role: row.actor_role,
      actor_email: row.actor_email,
      read_at: row.read_at,
      created_at: row.created_at,
      issue_number: row.issue_number,
      issue_title: row.issue_title,
      project_key: row.project_key,
      project_name: row.project_name,
      comment_body: row.comment_body,
      comment_author_role: row.comment_author_role,
    })),
    unread_count: unreadResult.rows[0]?.count ?? 0,
  });
}

export const GET = withApiObservability(
  "GET /api/notifications",
  handleGET,
);
