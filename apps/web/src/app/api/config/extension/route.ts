import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
}

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

async function handleGET(request: Request) {
  if (!(await hasDashboardSession(request))) {
    return jsonError("UNAUTHORIZED", "Dashboard session required.");
  }

  const env = getEnv();
  const projectsResult = await query<ProjectRow>(
    "SELECT id, name, key FROM projects ORDER BY name",
  );

  const response = NextResponse.json({
    appBaseUrl: requestOrigin(request),
    cdnBaseUrl: env.CDN_BASE_URL,
    workspaceToken: env.WORKSPACE_TOKEN,
    cdnToken: env.CDN_AUTH_TOKEN,
    projects: projectsResult.rows.map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
    })),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = withApiObservability(
  "GET /api/config/extension",
  handleGET,
);
