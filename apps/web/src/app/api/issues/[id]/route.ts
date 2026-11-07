import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { verifyDraftTokenForIssue } from "@/lib/draft-token";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";
import { updateIssueSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

function extractDraftToken(request: Request): string | null {
  const queryToken = new URL(request.url).searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim() || null;
  }

  return null;
}

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

interface MutableIssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
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

  const parsed = updateIssueSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid issue update.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  const currentResult = await query<{
    title: string;
    description: string | null;
    priority: number;
    status: string;
    report_type: string;
    raw_image_url: string | null;
    annotated_image_url: string | null;
    audio_note_url: string | null;
  } & QueryResultRow>(
    `SELECT title, description, priority, status, report_type, raw_image_url, annotated_image_url, audio_note_url FROM issues WHERE id = $1`,
    [id],
  );
  const current = currentResult.rows[0];
  if (!current) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  const result = await query<MutableIssueRow>(
    `UPDATE issues
        SET title = $2,
            description = $3,
            priority = $4,
            status = $5,
            report_type = $6,
            raw_image_url = $7,
            annotated_image_url = $8,
            audio_note_url = $9,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, issue_number, title, description, priority, status, report_type, updated_at`,
    [
      id,
      payload.title ?? current.title,
      payload.description !== undefined ? payload.description : current.description,
      payload.priority ?? current.priority,
      payload.status ?? current.status,
      payload.report_type ?? current.report_type,
      payload.raw_image_url !== undefined
        ? payload.raw_image_url
        : current.raw_image_url,
      payload.annotated_image_url !== undefined
        ? payload.annotated_image_url
        : current.annotated_image_url,
      payload.audio_note_url !== undefined
        ? payload.audio_note_url
        : current.audio_note_url,
    ],
  );

  if (payload.supplementary_assets !== undefined) {
    await query(
      "DELETE FROM issue_supplementary_assets WHERE issue_id = $1",
      [id],
    );
    for (const asset of payload.supplementary_assets ?? []) {
      await query(
        `INSERT INTO issue_supplementary_assets (issue_id, asset_url, asset_type)
         VALUES ($1, $2, $3)`,
        [id, asset.url, asset.asset_type],
      );
    }
  }

  return NextResponse.json({ issue: result.rows[0] });
}

async function handleDELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const hasSession = await hasDashboardSession(request);

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  // The tokenized canvas editor is unauthenticated, so its draft token may
  // delete its own draft. It can never delete a submitted issue.
  let draftTokenOnly = false;
  if (!hasSession) {
    const token = extractDraftToken(request);
    if (!token) {
      return jsonError(
        "UNAUTHORIZED",
        "A draft token or dashboard session is required.",
      );
    }
    const verified = verifyDraftTokenForIssue(token, id);
    if (!verified.ok) {
      return jsonError("UNAUTHORIZED", "Invalid or expired draft token.");
    }
    draftTokenOnly = true;
  }

  const result = await query(
    draftTokenOnly
      ? "DELETE FROM issues WHERE id = $1 AND status = 'draft' RETURNING id"
      : "DELETE FROM issues WHERE id = $1 RETURNING id",
    [id],
  );

  if (!result.rows[0]) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  return NextResponse.json({ ok: true, id });
}

export const GET = withApiObservability("GET /api/issues/[id]", handleGET);
export const PATCH = withApiObservability("PATCH /api/issues/[id]", handlePATCH);
export const DELETE = withApiObservability("DELETE /api/issues/[id]", handleDELETE);
