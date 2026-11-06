import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { logEvent, logRequest } from "./logger";

export const REQUEST_ID_HEADER = "x-request-id";

export function getRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (incoming) {
    return incoming;
  }

  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * Wrap an API route handler so every request produces one structured JSON log
 * line with method, path, status, duration and request id, and so unexpected
 * errors are reported to Sentry with the same correlation id.
 */
export function withApiObservability<TContext = unknown>(
  route: string,
  handler: (request: Request, context: TContext) => Promise<Response>,
) {
  return async (
    request: Request,
    context?: TContext,
  ): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const method = request.method;
    let path = route;
    try {
      path = new URL(request.url).pathname;
    } catch {
      // Keep the route label when the URL cannot be parsed.
    }

    try {
      const response = await handler(request, context as TContext);
      withRequestId(response, requestId);
      logRequest({
        request_id: requestId,
        method,
        path,
        status: response.status,
        duration_ms: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      Sentry.withScope((scope) => {
        scope.setTag("request_id", requestId);
        scope.setTag("route", route);
        scope.setContext("request", { method, path });
        Sentry.captureException(error);
      });

      logEvent("error", "request_failed", {
        request_id: requestId,
        method,
        path,
        duration_ms: Date.now() - startedAt,
        error_name: error instanceof Error ? error.name : "Error",
      });
      logRequest({
        request_id: requestId,
        method,
        path,
        status: 500,
        duration_ms: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
            request_id: requestId,
          },
        },
        {
          status: 500,
          headers: { [REQUEST_ID_HEADER]: requestId },
        },
      );
    }
  };
}
