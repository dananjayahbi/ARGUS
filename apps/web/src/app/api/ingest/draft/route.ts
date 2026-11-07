import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";

import { jsonError } from "@/lib/api-errors";
import { verifyWorkspaceToken } from "@/lib/auth";
import { query } from "@/lib/db";
import { signDraftToken } from "@/lib/draft-token";
import { ingestDraftSchema } from "@/lib/validation";
import { withApiObservability } from "@/lib/observability";

export const dynamic = "force-dynamic";

interface ProjectRow extends QueryResultRow {
  id: string;
  key: string;
}

interface CreatedIssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
}

const DEFAULT_DRAFT_TITLE = "Untitled draft";
const DEFAULT_DRAFT_PRIORITY = 50;

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host =
    forwardedHost?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;
  const proto =
    forwardedProto?.split(",")[0]?.trim() || url.protocol.replace(":", "");

  return `${proto}://${host}`;
}

async function handlePOST(request: Request) {
  if (!verifyWorkspaceToken(request)) {
    return jsonError(
      "UNAUTHORIZED",
      "Invalid or missing workspace authorization token.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = ingestDraftSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid draft payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  let project: ProjectRow | undefined;
  try {
    const result = await query<ProjectRow>(
      "SELECT id, key FROM projects WHERE id = $1",
      [payload.project_id],
    );
    project = result.rows[0];
  } catch (error) {
    console.error("[argus] project lookup failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to create the draft.");
  }

  if (!project) {
    return jsonError("NOT_FOUND", "Project not found.", {
      project_id: payload.project_id,
    });
  }

  const issueId = randomUUID();
  const { token, expiresAt } = signDraftToken(issueId);

  try {
    const result = await query<CreatedIssueRow>(
      `INSERT INTO issues (
         id, project_id, title, description, priority, status, report_type,
         raw_image_url, environment_info, console_logs, ephemeral_token,
         token_expires_at
       )
       VALUES ($1, $2, $3, NULL, $4, 'draft', $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       RETURNING id, issue_number`,
      [
        issueId,
        payload.project_id,
        DEFAULT_DRAFT_TITLE,
        DEFAULT_DRAFT_PRIORITY,
        payload.report_type,
        payload.raw_image_url ?? null,
        payload.environment_info
          ? JSON.stringify(payload.environment_info)
          : null,
        payload.console_logs ? JSON.stringify(payload.console_logs) : null,
        token,
        expiresAt.toISOString(),
      ],
    );

    const issue = result.rows[0];

    if (payload.supplementary_assets?.length) {
      const placeholders = payload.supplementary_assets
        .map((_, index) => `($1, $${index * 2 + 2}, $${index * 2 + 3})`)
        .join(", ");
      const params = [
        issue.id,
        ...payload.supplementary_assets.flatMap((asset) => [
          asset.url,
          asset.asset_type,
        ]),
      ];

      await query(
        `INSERT INTO issue_supplementary_assets
           (issue_id, asset_url, asset_type)
         VALUES ${placeholders}`,
        params,
      );
    }

    const editorUrl = `${requestOrigin(request)}/canvas/${issue.id}?token=${encodeURIComponent(token)}`;

    return NextResponse.json(
      {
        issue_id: issue.id,
        draft_token: token,
        editor_url: editorUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[argus] draft insert failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to create the draft.");
  }
}

export const POST = withApiObservability(
  "POST /api/ingest/draft",
  handlePOST,
);
