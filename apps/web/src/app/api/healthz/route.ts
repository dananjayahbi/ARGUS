import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { withApiObservability } from "@/lib/observability";

export const dynamic = "force-dynamic";

async function handleGET() {
  getEnv();

  const startedAt = Date.now();

  try {
    await query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      service: "argus-web",
      database: {
        reachable: true,
        latency_ms: Date.now() - startedAt,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[argus] healthz database check failed", error);
    return jsonError("SERVICE_UNAVAILABLE", "Database is not reachable.");
  }
}

export const GET = withApiObservability("GET /api/healthz", handleGET);
