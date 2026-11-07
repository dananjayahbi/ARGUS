import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";
import { createIssueSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectRow extends QueryResultRow {
  id: string;
  key: string;
}

interface CreatedIssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  report_type: string;
  updated_at: Date;
}

async function handlePOST(request: Request) {
  if (!(await hasDashboardSession(request))) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = createIssueSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid issue payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  const projectResult = await query<ProjectRow>(
    "SELECT id, key FROM projects WHERE key = $1",
    [payload.project_key],
  );
  const project = projectResult.rows[0];
  if (!project) {
    return jsonError("NOT_FOUND", "Project not found.");
  }

  const result = await query<CreatedIssueRow>(
    `INSERT INTO issues (
       project_id, title, description, priority, status, report_type,
       raw_image_url, annotated_image_url, audio_note_url
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, issue_number, title, description, priority, status, report_type, updated_at`,
    [
      project.id,
      payload.title,
      payload.description ?? null,
      payload.priority ?? 50,
      payload.status ?? "pending",
      payload.report_type ?? "text_only",
      payload.raw_image_url ?? null,
      payload.annotated_image_url ?? null,
      payload.audio_note_url ?? null,
    ],
  );

  const issue = result.rows[0];

  if (payload.supplementary_assets?.length) {
    for (const asset of payload.supplementary_assets) {
      await query(
        `INSERT INTO issue_supplementary_assets (issue_id, asset_url, asset_type)
         VALUES ($1, $2, $3)`,
        [issue.id, asset.url, asset.asset_type],
      );
    }
  }

  return NextResponse.json({ issue }, { status: 201 });
}

export const POST = withApiObservability("POST /api/issues", handlePOST);
