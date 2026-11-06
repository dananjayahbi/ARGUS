import { describe, expect, it } from "vitest";

import { API_ERROR_STATUS, jsonError } from "./api-errors";

describe("jsonError", () => {
  it("returns the documented status and body", async () => {
    const response = jsonError("UNAUTHORIZED", "Missing workspace token.");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing workspace token.",
      },
    });
  });

  it("includes details only when provided", async () => {
    const response = jsonError("BAD_REQUEST", "Invalid payload.", {
      field: "project_id",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid payload.",
        details: { field: "project_id" },
      },
    });
  });

  it("maps every code to its HTTP status", () => {
    expect(API_ERROR_STATUS.INTERNAL_ERROR).toBe(500);
    expect(API_ERROR_STATUS.SERVICE_UNAVAILABLE).toBe(503);
    expect(API_ERROR_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
    expect(API_ERROR_STATUS.UNSUPPORTED_MEDIA_TYPE).toBe(415);
  });
});
