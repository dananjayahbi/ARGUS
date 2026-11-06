import { SignJWT, jwtVerify } from "jose";

import { getAuthConfig } from "./auth-config";

export const SESSION_COOKIE = "argus_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionClaims {
  sid: string;
  sub: string;
  email: string;
  role: "qa" | "developer";
}

export interface VerifiedSessionClaims extends SessionClaims {
  iat: number;
  exp: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getAuthConfig().SESSION_SECRET);
}

export async function signSessionJwt(
  claims: SessionClaims,
): Promise<string> {
  return new SignJWT({
    sid: claims.sid,
    email: claims.email,
    role: claims.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function verifySessionJwt(
  token: string,
): Promise<VerifiedSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });

    if (
      typeof payload.sid !== "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      (payload.role !== "qa" && payload.role !== "developer")
    ) {
      return null;
    }

    return {
      sid: payload.sid,
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
