import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

interface IssueDetailRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  report_type: string;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  canvas_state: unknown;
  audio_note_url: string | null;
  environment_info: unknown;
  console_logs: unknown;
  created_at: Date;
  updated_at: Date;
  project_id: string;
  project_key: string;
  project_name: string;
}

interface NoteRow extends QueryResultRow {
  id: string;
  author_role: string;
  note: string;
  attachment_urls: string[] | null;
  created_at: Date;
}

interface AssetRow extends QueryResultRow {
  id: string;
  asset_url: string;
  asset_type: string;
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

  const issueResult = await query<IssueDetailRow>(
    `SELECT i.id,
            i.issue_number,
            i.title,
            i.description,
            i.priority,
            i.status,
            i.report_type,
            i.raw_image_url,
            i.annotated_image_url,
            i.canvas_state,
            i.audio_note_url,
            i.environment_info,
            i.console_logs,
            i.created_at,
            i.updated_at,
            p.id AS project_id,
            p.key AS project_key,
            p.name AS project_name
       FROM issues i
       JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1`,
    [id],
  );
  const issue = issueResult.rows[0];

  if (!issue) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  const [notesResult, assetsResult] = await Promise.all([
    query<NoteRow>(
      `SELECT id, author_role, note, attachment_urls, created_at
         FROM issue_reconsider_notes
        WHERE issue_id = $1
        ORDER BY created_at ASC`,
      [id],
    ),
    query<AssetRow>(
      `SELECT id, asset_url, asset_type, created_at
         FROM issue_supplementary_assets
        WHERE issue_id = $1
        ORDER BY created_at ASC`,
      [id],
    ),
  ]);

  return NextResponse.json({
    issue: {
      id: issue.id,
      issue_number: issue.issue_number,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      status: issue.status,
      report_type: issue.report_type,
      raw_image_url: issue.raw_image_url,
      annotated_image_url: issue.annotated_image_url,
      canvas_state: issue.canvas_state,
      audio_note_url: issue.audio_note_url,
      environment_info: issue.environment_info,
      console_logs: issue.console_logs,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    },
    project: {
      id: issue.project_id,
      key: issue.project_key,
      name: issue.project_name,
    },
    notes: notesResult.rows,
    supplementary_assets: assetsResult.rows,
  });
}

export const GET = withApiObservability("GET /api/issues/[id]", handleGET);
