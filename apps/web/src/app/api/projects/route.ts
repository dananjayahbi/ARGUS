import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";
import { createProjectSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

async function handleGET(request: Request) {
  if (!(await hasDashboardSession(request))) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  const result = await query<ProjectRow>(
    "SELECT id, name, key, description, created_at, updated_at FROM projects ORDER BY name",
  );
  return NextResponse.json({ projects: result.rows });
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

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid project payload.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const payload = parsed.data;
  let result;
  try {
    result = await query<ProjectRow>(
      `INSERT INTO projects (name, key, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, key, description, created_at, updated_at`,
      [payload.name, payload.key, payload.description ?? null],
    );
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "23505") {
      return jsonError("CONFLICT", "A project with this key already exists.");
    }
    console.error("[argus] project insert failed", error);
    return jsonError("INTERNAL_ERROR", "Unable to create the project.");
  }

  return NextResponse.json({ project: result.rows[0] }, { status: 201 });
}

export const GET = withApiObservability("GET /api/projects", handleGET);
export const POST = withApiObservability("POST /api/projects", handlePOST);
