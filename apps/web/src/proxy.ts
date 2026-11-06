import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSessionJwt,
  verifySessionJwt,
} from "@/lib/auth-session";
import { logRequest } from "@/lib/logger";

export const REQUEST_ID_HEADER = "x-request-id";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Workspace-Token, Authorization",
};

function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export async function proxy(request: NextRequest) {
  const startedAt = Date.now();
  const { pathname } = request.nextUrl;
  const requestId =
    request.headers.get(REQUEST_ID_HEADER)?.trim() ||
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  if (pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") {
      const response = new NextResponse(null, {
        status: 204,
        headers: { ...CORS_HEADERS, [REQUEST_ID_HEADER]: requestId },
      });
      logRequest({
        request_id: requestId,
        method: request.method,
        path: pathname,
        status: response.status,
        duration_ms: Date.now() - startedAt,
      });
      return response;
    }

    // API route handlers are wrapped with withApiObservability, which emits
    // the completion log once the real status is known.
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return withRequestId(response, requestId);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionJwt(token) : null;

  let response: NextResponse;

  if (pathname === "/login") {
    if (claims) {
      response = NextResponse.redirect(new URL("/dashboard", request.url));
    } else {
      response = NextResponse.next({
        request: { headers: requestHeaders },
      });
    }
  } else if (!claims) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${pathname}${request.nextUrl.search}`,
    );
    response = NextResponse.redirect(loginUrl);
  } else {
    response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    const refreshed = await signSessionJwt({
      sid: claims.sid,
      sub: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    response.cookies.set(SESSION_COOKIE, refreshed, sessionCookieOptions());
  }

  withRequestId(response, requestId);
  logRequest({
    request_id: requestId,
    method: request.method,
    path: pathname,
    status: response.status,
    duration_ms: Date.now() - startedAt,
  });
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/login",
    "/api/:path*",
  ],
};
