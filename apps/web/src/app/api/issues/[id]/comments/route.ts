import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import type { AuthorRole } from "@/lib/db-types";
import { withApiObservability } from "@/lib/observability";
import { getRequestSession } from "@/lib/session";
import { createCommentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

interface CommentRow extends QueryResultRow {
  id: string;
  author_user_id: string | null;
  author_role: AuthorRole;
  body: string;
  created_at: Date;
}

interface AttachmentRow extends QueryResultRow {
  id: string;
  comment_id: string;
  asset_url: string;
  asset_type: string;
  file_name: string | null;
  size_bytes: string | number | null;
  created_at: Date;
}

function serialiseAttachment(attachment: AttachmentRow) {
  return {
    id: attachment.id,
    url: attachment.asset_url,
    asset_type: attachment.asset_type,
    file_name: attachment.file_name,
    size_bytes:
      attachment.size_bytes === null
        ? null
        : Number(attachment.size_bytes),
    created_at: attachment.created_at,
  };
}

async function handleGET(
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

  const commentsResult = await query<CommentRow>(
    `SELECT id, author_user_id, author_role, body, created_at
       FROM issue_comments
      WHERE issue_id = $1
      ORDER BY created_at ASC, id ASC`,
    [id],
  );

  const comments = commentsResult.rows;
  let attachments: AttachmentRow[] = [];

  if (comments.length > 0) {
    const attachmentResult = await query<AttachmentRow>(
      `SELECT id, comment_id, asset_url, asset_type, file_name, size_bytes, created_at
         FROM issue_comment_attachments
        WHERE comment_id = ANY($1::uuid[])
        ORDER BY created_at ASC, id ASC`,
      [comments.map((comment) => comment.id)],
    );
    attachments = attachmentResult.rows;
  }

  const attachmentsByComment = new Map<string, AttachmentRow[]>();
  for (const attachment of attachments) {
    const list = attachmentsByComment.get(attachment.comment_id) ?? [];
    list.push(attachment);
    attachmentsByComment.set(attachment.comment_id, list);
  }

  return NextResponse.json({
    viewer: session.user,
    comments: comments.map((comment) => ({
      id: comment.id,
      author_user_id: comment.author_user_id,
      author_role: comment.author_role,
      body: comment.body,
      created_at: comment.created_at,
      attachments: (attachmentsByComment.get(comment.id) ?? []).map(
        serialiseAttachment,
      ),
    })),
  });
}

async function handlePOST(
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

  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid comment payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;

  try {
    const commentResult = await query<CommentRow>(
      `INSERT INTO issue_comments (issue_id, author_user_id, author_role, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, author_user_id, author_role, body, created_at`,
      [id, session.user.id, session.user.role, payload.body.trim()],
    );
    const comment = commentResult.rows[0];

    const attachments: AttachmentRow[] = [];
    for (const attachment of payload.attachments) {
      const attachmentResult = await query<AttachmentRow>(
        `INSERT INTO issue_comment_attachments
           (comment_id, asset_url, asset_type, file_name, size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, comment_id, asset_url, asset_type, file_name, size_bytes, created_at`,
        [
          comment.id,
          attachment.url,
          attachment.asset_type,
          attachment.file_name ?? null,
          attachment.size_bytes ?? null,
        ],
      );
      attachments.push(attachmentResult.rows[0]);
    }

    await query(
      "UPDATE issues SET updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id],
    );

    // Notify every other dashboard user (developer ↔ QA) about the comment.
    await query(
      `INSERT INTO notifications
         (user_id, issue_id, comment_id, actor_user_id, actor_role)
       SELECT u.id, $1, $2, $3, $4
         FROM users u
        WHERE u.id <> $3`,
      [id, comment.id, session.user.id, session.user.role],
    );

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          author_user_id: comment.author_user_id,
          author_role: comment.author_role,
          body: comment.body,
          created_at: comment.created_at,
          attachments: attachments.map(serialiseAttachment),
        },
        notified: true,
      },
      { status: 201 },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23503") {
      return jsonError("NOT_FOUND", "Issue not found.");
    }

    console.error("[argus] comment creation failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to save the comment.");
  }
}

export const GET = withApiObservability(
  "GET /api/issues/[id]/comments",
  handleGET,
);
export const POST = withApiObservability(
  "POST /api/issues/[id]/comments",
  handlePOST,
);
