import { describe, expect, it } from "vitest";

import { ingestDraftSchema } from "./validation";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const basePayload = {
  project_id: PROJECT_ID,
  report_type: "screenshot",
  raw_image_url: "https://cdn.example/raw/2026/11/shot.png",
  environment_info: {
    url: "https://target.example",
    title: "Target",
    viewport: { width: 1280, height: 720 },
    screen: { width: 2560, height: 1440 },
    device_pixel_ratio: 2,
    user_agent: "Mozilla/5.0",
    os: "Windows",
  },
  console_logs: [
    {
      type: "error",
      message: "boom",
      stack_or_detail: "at app.js:1",
      timestamp: "2026-11-06T00:00:00.000Z",
    },
  ],
};

describe("ingestDraftSchema", () => {
  it("accepts a screenshot payload with an image", () => {
    expect(ingestDraftSchema.safeParse(basePayload).success).toBe(true);
  });

  it("accepts telemetry-free payloads without inventing screen dimensions", () => {
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        environment_info: {
          url: "https://target.example",
          title: "Target",
          viewport: { width: 1280, height: 720 },
          device_pixel_ratio: 1,
          os: "Unknown",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects zero-sized screen dimensions", () => {
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        environment_info: {
          ...basePayload.environment_info,
          screen: { width: 0, height: 0 },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts extra screenshots and captured page telemetry", () => {
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        environment_info: {
          ...basePayload.environment_info,
          captured_pages: [
            {
              url: "https://target.example",
              title: "Target",
              captured_at: "2026-11-06T00:00:00.000Z",
              asset_url: "https://cdn.example/raw/2026/11/shot.png",
              kind: "primary",
            },
          ],
        },
        supplementary_assets: [
          {
            url: "https://cdn.example/raw/2026/11/second.png",
            asset_type: "image/png",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires raw_image_url for screenshot and full_page", () => {
    const withoutImage = { ...basePayload, raw_image_url: undefined };

    expect(ingestDraftSchema.safeParse(withoutImage).success).toBe(false);
    expect(
      ingestDraftSchema.safeParse({
        ...withoutImage,
        report_type: "full_page",
      }).success,
    ).toBe(false);
  });

  it("accepts text_only without raw_image_url", () => {
    const textOnly = {
      ...basePayload,
      report_type: "text_only",
      raw_image_url: undefined,
    };

    expect(ingestDraftSchema.safeParse(textOnly).success).toBe(true);
  });

  it("rejects an unknown report_type", () => {
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        report_type: "video",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-UUID project_id", () => {
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        project_id: "argus",
      }).success,
    ).toBe(false);
  });

  it("rejects more than 50 console log entries", () => {
    const entry = basePayload.console_logs[0];
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        console_logs: Array.from({ length: 51 }, () => entry),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    expect(
      ingestDraftSchema.safeParse({
        ...basePayload,
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
