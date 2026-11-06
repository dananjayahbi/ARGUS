import { NextResponse } from "next/server";

export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export interface ApiErrorPayload {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Return a consistent JSON error body for every API route.
 *
 * Shape: { "error": { "code": "...", "message": "...", "details": ... } }
 */
export function jsonError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorPayload> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status: API_ERROR_STATUS[code] },
  );
}
