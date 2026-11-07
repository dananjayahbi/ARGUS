import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { getRequestSession } from "@/lib/session";
import { issuePositionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const ORDER_GAP = 1024;
const MIN_GAP = 0.0001;

interface ProjectRow extends QueryResultRow {
  project_id: string;
}

interface OrderRow extends QueryResultRow {
  board_order: number;
}

interface MaxOrderRow extends QueryResultRow {
  max_order: number | null;
}

interface UpdatedIssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  report_type: string;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  updated_at: Date;
  created_at: Date;
  board_order: number;
}

async function renumberColumn(projectId: string, status: string) {
  await query(
    `WITH ranked AS (
       SELECT id,
              row_number() OVER (ORDER BY board_order ASC, issue_number ASC) AS position
         FROM issues
        WHERE project_id = $1
          AND status = $2
     )
     UPDATE issues
        SET board_order = ranked.position * ${ORDER_GAP}
       FROM ranked
      WHERE issues.id = ranked.id`,
    [projectId, status],
  );
}

async function fetchOrder(
  issueId: string | null | undefined,
  projectId: string,
  status: string,
): Promise<number | null> {
  if (!issueId) {
    return null;
  }

  const result = await query<OrderRow>(
    `SELECT board_order
       FROM issues
      WHERE id = $1
        AND project_id = $2
        AND status = $3`,
    [issueId, projectId, status],
  );

  return result.rows[0]?.board_order ?? null;
}

async function handlePATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getRequestSession(request);
  if (!session) {
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

  const parsed = issuePositionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid position payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  const projectResult = await query<ProjectRow>(
    "SELECT project_id FROM issues WHERE id = $1",
    [id],
  );
  const project = projectResult.rows[0];
  if (!project) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  let previousOrder = await fetchOrder(
    payload.previous_issue_id,
    project.project_id,
    payload.status,
  );
  let nextOrder = await fetchOrder(
    payload.next_issue_id,
    project.project_id,
    payload.status,
  );

  if (
    previousOrder !== null &&
    nextOrder !== null &&
    Math.abs(nextOrder - previousOrder) < MIN_GAP
  ) {
    await renumberColumn(project.project_id, payload.status);
    previousOrder = await fetchOrder(
      payload.previous_issue_id,
      project.project_id,
      payload.status,
    );
    nextOrder = await fetchOrder(
      payload.next_issue_id,
      project.project_id,
      payload.status,
    );
  }

  let boardOrder: number;
  if (previousOrder !== null && nextOrder !== null) {
    boardOrder = (previousOrder + nextOrder) / 2;
  } else if (previousOrder !== null) {
    boardOrder = previousOrder + ORDER_GAP;
  } else if (nextOrder !== null) {
    boardOrder = nextOrder - ORDER_GAP;
  } else {
    const maxResult = await query<MaxOrderRow>(
      `SELECT MAX(board_order) AS max_order
         FROM issues
        WHERE project_id = $1
          AND status = $2`,
      [project.project_id, payload.status],
    );
    boardOrder = (maxResult.rows[0]?.max_order ?? 0) + ORDER_GAP;
  }

  const result = await query<UpdatedIssueRow>(
    `UPDATE issues AS target
        SET status = $2::text,
            board_order = $3,
            updated_at = CASE
              WHEN target.status <> $2::text THEN CURRENT_TIMESTAMP
              ELSE target.updated_at
            END
      WHERE target.id = $1
      RETURNING target.id,
                target.issue_number,
                target.title,
                target.description,
                target.priority,
                target.status,
                target.report_type,
                target.raw_image_url,
                target.annotated_image_url,
                target.updated_at,
                target.created_at,
                target.board_order`,
    [id, payload.status, boardOrder],
  );

  const issue = result.rows[0];
  if (!issue) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  return NextResponse.json({ issue });
}

export const PATCH = withApiObservability(
  "PATCH /api/issues/[id]/position",
  handlePATCH,
);
