import { describe, expect, it } from "vitest";

import { parseCapturedPages } from "./captured-pages";

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
