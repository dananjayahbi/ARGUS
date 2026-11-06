import { createHash, timingSafeEqual } from "node:crypto";

import { getEnv } from "./env";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Compare X-Workspace-Token with WORKSPACE_TOKEN in constant time.
 * Hashing first keeps the comparison independent of the supplied length.
 */
export function verifyWorkspaceToken(request: Request): boolean {
  const provided = request.headers.get("x-workspace-token");
  if (!provided) {
    return false;
  }

  return timingSafeEqual(sha256(provided), sha256(getEnv().WORKSPACE_TOKEN));
}
