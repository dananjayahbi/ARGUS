import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionJwt,
} from "@/lib/auth-session";
import { query } from "@/lib/db";
import { withApiObservability } from "@/lib/observability";

export const runtime = "nodejs";

async function handlePOST(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)argus_session=([^;]+)/);

  if (match) {
    const claims = await verifySessionJwt(decodeURIComponent(match[1]));
    if (claims) {
      await query("DELETE FROM sessions WHERE id = $1", [claims.sid]);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export const POST = withApiObservability("POST /api/auth/logout", handlePOST);
