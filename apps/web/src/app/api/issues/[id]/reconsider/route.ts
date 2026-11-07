import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";

export const runtime = "nodejs";

const idSchema = z.string().uuid();
const reconsiderSchema = z.object({
  author_role: z.enum(["developer", "qa"]),
  note: z.string().trim().min(1, "note is required"),
  attachment_urls: z.array(z.string().url()).max(20).optional(),
});

interface NoteRow extends QueryResultRow {
  id: string;
}

async function handlePOST(
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

  const parsed = reconsiderSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid reconsider payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const currentStatus =
    parsed.data.author_role === "developer" ? "reconsider" : "working";

  try {
    const noteResult = await query<NoteRow>(
      `INSERT INTO issue_reconsider_notes
         (issue_id, author_role, note, attachment_urls)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        id,
        parsed.data.author_role,
        parsed.data.note,
        parsed.data.attachment_urls ?? null,
      ],
    );

    const updateResult = await query<{ board_order: number } & QueryResultRow>(
      `UPDATE issues AS target
          SET status = $2::text,
              board_order = COALESCE(
                (SELECT MAX(board_order) + 1024
                   FROM issues
                  WHERE project_id = target.project_id
                    AND status = $2::text
                    AND id <> target.id),
                1024
              ),
              updated_at = CURRENT_TIMESTAMP
        WHERE target.id = $1
        RETURNING target.board_order`,
      [id, currentStatus],
    );

    if (updateResult.rowCount !== 1) {
      return jsonError("NOT_FOUND", "Issue not found.");
    }

    return NextResponse.json(
      {
        note_id: noteResult.rows[0].id,
        current_status: currentStatus,
        board_order: updateResult.rows[0]?.board_order ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23503") {
      return jsonError("NOT_FOUND", "Issue not found.");
    }

    console.error("[argus] reconsider note failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to save the reconsider note.");
  }
}

export const POST = withApiObservability(
  "POST /api/issues/[id]/reconsider",
  handlePOST,
);
