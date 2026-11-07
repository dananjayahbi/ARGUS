import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";
import { updateProjectSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const keySchema = z.string().min(1).max(10);

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

async function loadByKey(key: string) {
  const result = await query<ProjectRow>(
    "SELECT id, name, key, description, created_at, updated_at FROM projects WHERE key = $1",
    [key],
  );
  return result.rows[0];
}

async function handlePATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  if (!(await hasDashboardSession(request))) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  const { key } = await context.params;
  if (!keySchema.safeParse(key).success) {
    return jsonError("NOT_FOUND", "Project not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid project update.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const current = await loadByKey(key);
  if (!current) {
    return jsonError("NOT_FOUND", "Project not found.");
  }

  const payload = parsed.data;
  const result = await query<ProjectRow>(
    `UPDATE projects
        SET name = $2,
            description = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE key = $1
      RETURNING id, name, key, description, created_at, updated_at`,
    [
      key,
      payload.name ?? current.name,
      payload.description !== undefined ? payload.description : current.description,
    ],
  );

  return NextResponse.json({ project: result.rows[0] });
}

async function handleDELETE(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  if (!(await hasDashboardSession(request))) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  const { key } = await context.params;
  if (!keySchema.safeParse(key).success) {
    return jsonError("NOT_FOUND", "Project not found.");
  }

  const result = await query(
    "DELETE FROM projects WHERE key = $1 RETURNING id, key",
    [key],
  );

  if (!result.rows[0]) {
    return jsonError("NOT_FOUND", "Project not found.");
  }

  return NextResponse.json({ ok: true, key });
}

export const PATCH = withApiObservability("PATCH /api/projects/[key]", handlePATCH);
export const DELETE = withApiObservability("DELETE /api/projects/[key]", handleDELETE);
