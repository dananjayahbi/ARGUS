import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { getRequestSession } from "@/lib/session";
import { markNotificationsReadSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UnreadRow extends QueryResultRow {
  count: number;
}

async function handlePOST(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = markNotificationsReadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid notification update.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  if (parsed.data.all) {
    await query(
      `UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND read_at IS NULL`,
      [session.user.id],
    );
  } else {
    await query(
      `UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND read_at IS NULL
          AND id = ANY($2::uuid[])`,
      [session.user.id, parsed.data.ids],
    );
  }

  const unreadResult = await query<UnreadRow>(
    `SELECT count(*)::int AS count
       FROM notifications
      WHERE user_id = $1
        AND read_at IS NULL`,
    [session.user.id],
  );

  return NextResponse.json({
    ok: true,
    unread_count: unreadResult.rows[0]?.count ?? 0,
  });
}

export const POST = withApiObservability(
  "POST /api/notifications/read",
  handlePOST,
);
