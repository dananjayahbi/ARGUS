import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api-errors";
import { verifyDraftTokenForIssue } from "@/lib/draft-token";
import { getEnv } from "@/lib/env";
import { withApiObservability } from "@/lib/observability";
import { hasDashboardSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES = new Set([
  "raw",
  "annotated",
  "reconsider",
  "audio",
  "files",
]);

function extractToken(request: Request): string | null {
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

/**
 * Proxy canvas uploads to the Python CDN. The CDN auth token stays on the
 * server; the browser only presents its short-lived draft token.
 */
async function handlePOST(request: Request) {
  const url = new URL(request.url);
  const issueId = url.searchParams.get("issueId");
  const token = extractToken(request);
  const hasSession = await hasDashboardSession(request);

  if (!hasSession) {
    if (!issueId || !token) {
      return jsonError(
        "UNAUTHORIZED",
        "A draft token and issue id are required.",
      );
    }

    const verification = verifyDraftTokenForIssue(token, issueId);
    if (!verification.ok) {
      return jsonError("UNAUTHORIZED", "Invalid or expired draft token.");
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(
      "BAD_REQUEST",
      "Request body must be multipart form data.",
    );
  }

  const file = form.get("file");
  const category = form.get("category");

  if (!(file instanceof Blob)) {
    return jsonError("BAD_REQUEST", "A file is required.");
  }

  if (
    typeof category !== "string" ||
    !ALLOWED_CATEGORIES.has(category)
  ) {
    return jsonError(
      "BAD_REQUEST",
      "category must be raw, annotated, reconsider, audio or files.",
    );
  }

  const env = getEnv();
  const outgoing = new FormData();
  outgoing.append("category", category);
  outgoing.append(
    "file",
    file,
    file instanceof File ? file.name : "upload.bin",
  );

  let cdnResponse: Response;
  try {
    cdnResponse = await fetch(`${env.CDN_BASE_URL}/api/upload`, {
      method: "POST",
      headers: { "X-CDN-Auth-Token": env.CDN_AUTH_TOKEN },
      body: outgoing,
    });
  } catch (error) {
    console.error("[argus] CDN upload proxy failed", error);
    return jsonError(
      "SERVICE_UNAVAILABLE",
      "The storage service is not reachable.",
    );
  }

  const text = await cdnResponse.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: "Unexpected CDN response." };
  }

  return NextResponse.json(body, { status: cdnResponse.status });
}

export const POST = withApiObservability("POST /api/uploads", handlePOST);
