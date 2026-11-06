import type { QueryResultRow } from "pg";

import { CanvasAccessDenied } from "@/components/canvas/CanvasAccessDenied";
import { CanvasEditorShell } from "@/components/canvas/CanvasEditorShell";
import type { CanvasDraftData } from "@/lib/canvas-types";
import { query } from "@/lib/db";
import { verifyDraftTokenForIssue } from "@/lib/draft-token";

export const dynamic = "force-dynamic";

interface CanvasIssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  report_type: string;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  audio_note_url: string | null;
  canvas_state: unknown;
  environment_info: unknown;
  console_logs: unknown;
  status: string;
  project_key: string;
  project_name: string;
}

function toDraftData(issue: CanvasIssueRow): CanvasDraftData {
  return {
    id: issue.id,
    issue_number: issue.issue_number,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    report_type: issue.report_type,
    raw_image_url: issue.raw_image_url,
    annotated_image_url: issue.annotated_image_url,
    audio_note_url: issue.audio_note_url,
    canvas_state: issue.canvas_state,
    environment_info: issue.environment_info,
    console_logs: issue.console_logs,
    project_key: issue.project_key,
    project_name: issue.project_name,
  };
}

export default async function CanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { draftId } = await params;
  const { token: rawToken } = await searchParams;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  if (!token) {
    return <CanvasAccessDenied reason="missing" />;
  }

  const verification = verifyDraftTokenForIssue(token, draftId);
  if (!verification.ok) {
    return <CanvasAccessDenied reason={verification.error} />;
  }

  let issue: CanvasIssueRow | undefined;
  try {
    const result = await query<CanvasIssueRow>(
      `SELECT i.id,
              i.issue_number,
              i.title,
              i.description,
              i.priority,
              i.report_type,
              i.raw_image_url,
              i.annotated_image_url,
              i.audio_note_url,
              i.canvas_state,
              i.environment_info,
              i.console_logs,
              i.status,
              p.key AS project_key,
              p.name AS project_name
         FROM issues i
         JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1`,
      [draftId],
    );
    issue = result.rows[0];
  } catch (error) {
    console.error("[argus] canvas draft lookup failed", error);
    return <CanvasAccessDenied reason="unavailable" />;
  }

  if (!issue) {
    return <CanvasAccessDenied reason="not_found" />;
  }

  if (issue.status !== "draft") {
    return <CanvasAccessDenied reason="already_submitted" />;
  }

  return <CanvasEditorShell issue={toDraftData(issue)} token={token} />;
}
