import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

interface NoteRow extends QueryResultRow {
  id: string;
  author_role: string;
  note: string;
  attachment_urls: string[] | null;
  created_at: Date;
}

async function handleGET(
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

  const result = await query<NoteRow>(
    `SELECT id, author_role, note, attachment_urls, created_at
       FROM issue_reconsider_notes
      WHERE issue_id = $1
      ORDER BY created_at ASC`,
    [id],
  );

  return NextResponse.json({ notes: result.rows });
}

export const GET = withApiObservability(
  "GET /api/issues/[id]/notes",
  handleGET,
);
