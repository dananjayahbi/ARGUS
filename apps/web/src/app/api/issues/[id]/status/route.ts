import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";

export const runtime = "nodejs";

const idSchema = z.string().uuid();
const statusSchema = z.object({
  status: z.enum(["draft", "pending", "working", "reconsider", "completed"]),
});

interface IssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  priority: number;
  status: string;
  report_type: string;
  updated_at: Date;
  created_at: Date;
  board_order: number;
}

async function handlePATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await hasDashboardSession(request))) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("UNPROCESSABLE_ENTITY", "Invalid status transition.");
  }

  if (parsed.data.status === "reconsider") {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Reconsider transitions require a note via /api/issues/[id]/reconsider.",
    );
  }

  const result = await query<IssueRow>(
    `UPDATE issues AS target
        SET status = $2::text,
            board_order = CASE
              WHEN target.status = $2::text THEN target.board_order
              ELSE COALESCE(
                (SELECT MAX(board_order) + 1024
                   FROM issues
                  WHERE project_id = target.project_id
                    AND status = $2::text
                    AND id <> target.id),
                1024
              )
            END,
            updated_at = CURRENT_TIMESTAMP
      WHERE target.id = $1
      RETURNING target.id,
                target.issue_number,
                target.title,
                target.priority,
                target.status,
                target.report_type,
                target.updated_at,
                target.created_at,
                target.board_order`,
    [id, parsed.data.status],
  );
  const issue = result.rows[0];

  if (!issue) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  return NextResponse.json({ issue });
}

export const PATCH = withApiObservability(
  "PATCH /api/issues/[id]/status",
  handlePATCH,
);
