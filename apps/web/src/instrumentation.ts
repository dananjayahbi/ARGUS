import type { Instrumentation } from "next";

/**
 * Next.js instrumentation hook. Runs once when the server starts, so a missing
 * or malformed environment fails fast with a readable message, and initialises
 * Sentry only when a DSN is configured.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    const { getEnv } = await import("./lib/env");
    getEnv();
    console.info("[argus] environment configuration validated.");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

function requestIdFromHeaders(
  headers: NodeJS.Dict<string | string[]> | undefined,
): string | null {
  if (!headers) {
    return null;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "x-request-id") {
      continue;
    }
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  return null;
}

/**
 * Next.js calls this for unhandled render, route, action and proxy errors.
 * The request id matches the header returned to the client and the JSON
 * request log line, so a support report can be traced end to end.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const Sentry = await import("@sentry/nextjs");
  const requestId = requestIdFromHeaders(request.headers);

  Sentry.withScope((scope) => {
    if (requestId) {
      scope.setTag("request_id", requestId);
    }
    scope.setTag("router_kind", context.routerKind);
    scope.setTag("route_path", context.routePath);
    scope.setTag("route_type", context.routeType);
    scope.setContext("request", {
      path: request.path,
      method: request.method,
    });
    Sentry.captureException(error);
  });
};
