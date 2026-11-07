import { describe, expect, it } from "vitest";

import { collectCaptureImages, parseCapturedPages } from "./captured-pages";

describe("parseCapturedPages", () => {
  it("returns an empty list when there is no telemetry", () => {
    expect(parseCapturedPages(null)).toEqual([]);
    expect(parseCapturedPages(undefined)).toEqual([]);
    expect(parseCapturedPages({})).toEqual([]);
  });

  it("falls back to the legacy single page url", () => {
    expect(
      parseCapturedPages({
        url: "https://app.example/login",
        title: "Sign in",
      }),
    ).toEqual([
      {
        url: "https://app.example/login",
        title: "Sign in",
        capturedAt: null,
        assetUrl: null,
        kind: "primary",
      },
    ]);
  });

  it("reads captured_pages in order and dedupes urls", () => {
    const pages = parseCapturedPages({
      url: "https://ignored.example",
      captured_pages: [
        {
          url: "https://app.example/a",
          title: "A",
          captured_at: "2026-11-07T10:00:00.000Z",
          asset_url: "https://cdn.example/a.png",
          kind: "primary",
        },
        {
          url: "https://app.example/b",
          title: "B",
          asset_url: "https://cdn.example/b.png",
          kind: "supplementary",
        },
        { url: "https://app.example/a", title: "duplicate" },
      ],
    });

    expect(pages.map((page) => page.url)).toEqual([
      "https://app.example/a",
      "https://app.example/b",
    ]);
    expect(pages[0]).toMatchObject({
      title: "A",
      assetUrl: "https://cdn.example/a.png",
      kind: "primary",
      capturedAt: "2026-11-07T10:00:00.000Z",
    });
    expect(pages[1]).toMatchObject({
      kind: "supplementary",
      assetUrl: "https://cdn.example/b.png",
    });
  });

  it("skips malformed entries", () => {
    const pages = parseCapturedPages({
      captured_pages: [
        null,
        "nope",
        { title: "no url" },
        { url: "   " },
        { url: "https://app.example/ok", kind: "unknown" },
      ],
    });

    expect(pages).toEqual([
      {
        url: "https://app.example/ok",
        title: null,
        capturedAt: null,
        assetUrl: null,
        kind: "primary",
      },
    ]);
  });
});

describe("collectCaptureImages", () => {
  const environmentInfo = {
    captured_pages: [
      {
        url: "https://app.example/a",
        title: "Page A",
        asset_url: "https://cdn.example/a.png",
        captured_at: "2026-11-07T10:00:00.000Z",
        kind: "primary",
      },
      {
        url: "https://app.example/b",
        title: "Page B",
        asset_url: "https://cdn.example/b.png",
        kind: "supplementary",
      },
    ],
  };

  it("orders the primary image first and joins page metadata", () => {
    const images = collectCaptureImages({
      environmentInfo,
      primaryUrl: "https://cdn.example/a.png",
      supplementaryAssets: [{ url: "https://cdn.example/b.png" }],
    });

    expect(images).toEqual([
      {
        url: "https://cdn.example/a.png",
        pageUrl: "https://app.example/a",
        title: "Page A",
        capturedAt: "2026-11-07T10:00:00.000Z",
        primary: true,
      },
      {
        url: "https://cdn.example/b.png",
        pageUrl: "https://app.example/b",
        title: "Page B",
        capturedAt: null,
        primary: false,
      },
    ]);
  });

  it("dedupes URLs across assets, telemetry and extras", () => {
    const images = collectCaptureImages({
      environmentInfo,
      primaryUrl: "https://cdn.example/a.png",
      supplementaryAssets: [
        { url: "https://cdn.example/b.png" },
        { url: "https://cdn.example/b.png" },
      ],
      extraUrls: ["https://cdn.example/b.png", "blob:preview"],
    });

    expect(images.map((image) => image.url)).toEqual([
      "https://cdn.example/a.png",
      "https://cdn.example/b.png",
      "blob:preview",
    ]);
  });

  it("keeps working for legacy issues with only a raw image", () => {
    const images = collectCaptureImages({
      environmentInfo: { url: "https://app.example/legacy", title: "Legacy" },
      primaryUrl: "https://cdn.example/legacy.png",
      supplementaryAssets: [],
    });

    expect(images).toEqual([
      {
        url: "https://cdn.example/legacy.png",
        pageUrl: "https://app.example/legacy",
        title: "Legacy",
        capturedAt: null,
        primary: true,
      },
    ]);
  });

  it("returns no images for a text-only report", () => {
    expect(
      collectCaptureImages({
        environmentInfo: { url: "https://app.example/text" },
        primaryUrl: null,
        supplementaryAssets: [],
      }),
    ).toEqual([]);
  });
});
