import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api-errors";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSessionJwt,
} from "@/lib/auth-session";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";
import { authenticate } from "@/lib/users";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function handlePOST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "UNPROCESSABLE_ENTITY",
      "Invalid credentials payload.",
    );
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    return jsonError("UNAUTHORIZED", "Invalid email or password.");
  }

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
    [sessionId, user.id, expiresAt.toISOString()],
  );

  const token = await signSessionJwt({
    sid: sessionId,
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.json({
    ok: true,
    user: { email: user.email, role: user.role },
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

export const POST = withApiObservability("POST /api/auth/login", handlePOST);
