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
    `UPDATE issues
        SET status = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, issue_number, title, priority, status, report_type, updated_at`,
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
