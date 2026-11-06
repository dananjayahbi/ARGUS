import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "./env";

export const DRAFT_TOKEN_TTL_SECONDS = 30 * 60;

export interface DraftTokenPayload {
  sub: string;
  iat: number;
  exp: number;
  scope: "canvas:draft";
}

export interface SignedDraftToken {
  token: string;
  expiresAt: Date;
}

export type DraftTokenError =
  | "malformed"
  | "invalid_signature"
  | "invalid_payload"
  | "expired"
  | "wrong_issue";

export type DraftTokenVerification =
  | { ok: true; payload: DraftTokenPayload }
  | { ok: false; error: DraftTokenError };

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(unsigned: string): string {
  return createHmac("sha256", getEnv().DRAFT_TOKEN_SECRET)
    .update(unsigned)
    .digest("base64url");
}

/**
 * Issue a compact JWT-like HS256 token scoped to one canvas draft.
 * The default lifetime is 30 minutes, matching §2.2 and §5.2.
 */
export function signDraftToken(
  issueId: string,
  options: { now?: Date; ttlSeconds?: number } = {},
): SignedDraftToken {
  const now = options.now ?? new Date();
  const ttlSeconds = options.ttlSeconds ?? DRAFT_TOKEN_TTL_SECONDS;
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;

  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(
    JSON.stringify({
      sub: issueId,
      iat,
      exp,
      scope: "canvas:draft",
    } satisfies DraftTokenPayload),
  );
  const unsigned = `${header}.${payload}`;

  return {
    token: `${unsigned}.${signature(unsigned)}`,
    expiresAt: new Date(exp * 1000),
  };
}

/** Verify signature, header, payload shape and expiry. */
export function verifyDraftToken(
  token: string,
  options: { now?: Date } = {},
): DraftTokenVerification {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "malformed" };
  }

  const [header, payload, providedSignature] = parts;

  try {
    const parsedHeader = JSON.parse(decode(header)) as {
      alg?: unknown;
      typ?: unknown;
    };
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") {
      return { ok: false, error: "invalid_payload" };
    }
  } catch {
    return { ok: false, error: "malformed" };
  }

  const expectedSignature = signature(`${header}.${payload}`);
  const providedBytes = Buffer.from(providedSignature, "utf8");
  const expectedBytes = Buffer.from(expectedSignature, "utf8");

  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return { ok: false, error: "invalid_signature" };
  }

  let parsedPayload: Partial<DraftTokenPayload>;
  try {
    parsedPayload = JSON.parse(decode(payload)) as Partial<DraftTokenPayload>;
  } catch {
    return { ok: false, error: "malformed" };
  }

  if (
    typeof parsedPayload.sub !== "string" ||
    parsedPayload.sub.length === 0 ||
    typeof parsedPayload.iat !== "number" ||
    typeof parsedPayload.exp !== "number" ||
    parsedPayload.scope !== "canvas:draft"
  ) {
    return { ok: false, error: "invalid_payload" };
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);

  if (parsedPayload.exp <= nowSeconds) {
    return { ok: false, error: "expired" };
  }

  if (parsedPayload.iat > nowSeconds + 60) {
    return { ok: false, error: "invalid_payload" };
  }

  return { ok: true, payload: parsedPayload as DraftTokenPayload };
}

/**
 * Verify a token and require it to belong to the supplied issue id.
 * This is the single entry point the canvas page and finalize route use.
 */
export function verifyDraftTokenForIssue(
  token: string,
  issueId: string,
  options: { now?: Date } = {},
): DraftTokenVerification {
  const verified = verifyDraftToken(token, options);

  if (!verified.ok) {
    return verified;
  }

  if (verified.payload.sub !== issueId) {
    return { ok: false, error: "wrong_issue" };
  }

  return verified;
}
