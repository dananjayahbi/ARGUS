import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { verifyDraftTokenForIssue } from "@/lib/draft-token";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";
import { finalizeIssueSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface IssueRow extends QueryResultRow {
  id: string;
  status: string;
  project_key: string;
}

interface FinalizedIssueRow extends QueryResultRow {
  id: string;
  status: string;
}

const issueIdSchema = z.string().uuid();

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

async function handlePUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!issueIdSchema.safeParse(id).success) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  const hasSession = await hasDashboardSession(request);
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
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = finalizeIssueSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid finalize payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  let issue: IssueRow | undefined;
  try {
    const result = await query<IssueRow>(
      `SELECT i.id, i.status, p.key AS project_key
         FROM issues i
         JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1`,
      [id],
    );
    issue = result.rows[0];
  } catch (error) {
    console.error("[argus] finalize lookup failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to finalize the issue.");
  }

  if (!issue) {
    return jsonError("NOT_FOUND", "Issue not found.");
  }

  if (issue.status !== "draft") {
    return jsonError("CONFLICT", "Only draft issues can be finalized.", {
      status: issue.status,
    });
  }

  try {
    const result = await query<FinalizedIssueRow>(
      `UPDATE issues AS target
          SET title = $2,
              description = $3,
              priority = $4,
              annotated_image_url = $5,
              canvas_state = $6::jsonb,
              audio_note_url = $7,
              raw_image_url = COALESCE($8, target.raw_image_url),
              status = 'pending',
              board_order = COALESCE(
                (SELECT MAX(board_order) + 1024
                   FROM issues
                  WHERE project_id = target.project_id
                    AND status = 'pending'
                    AND id <> target.id),
                1024
              ),
              ephemeral_token = NULL,
              token_expires_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE target.id = $1
          AND target.status = 'draft'
        RETURNING target.id, target.status`,
      [
        id,
        payload.title,
        payload.description ?? null,
        payload.priority,
        payload.annotated_image_url ?? null,
        payload.canvas_state ? JSON.stringify(payload.canvas_state) : null,
        payload.audio_note_url ?? null,
        payload.raw_image_url ?? null,
      ],
    );

    if (result.rowCount !== 1) {
      return jsonError("CONFLICT", "Only draft issues can be finalized.");
    }

    if (payload.supplementary_assets?.length) {
      const placeholders = payload.supplementary_assets
        .map((_, index) => `($1, $${index * 2 + 2}, $${index * 2 + 3})`)
        .join(", ");
      const params = [
        id,
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

    return NextResponse.json({
      success: true,
      status: "pending",
      redirect_url: `/projects/${encodeURIComponent(issue.project_key)}`,
    });
  } catch (error) {
    console.error("[argus] finalize update failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to finalize the issue.");
  }
}

export const PUT = withApiObservability(
  "PUT /api/issues/[id]/finalize",
  handlePUT,
);
