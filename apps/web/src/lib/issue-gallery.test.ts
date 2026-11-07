import { describe, expect, it } from "vitest";

import { buildIssueGallery } from "./issue-gallery";

describe("buildIssueGallery", () => {
  it("returns an empty gallery when nothing is attached", () => {
    expect(
      buildIssueGallery({
        issueNumber: 12,
        rawImageUrl: null,
        annotatedImageUrl: null,
        environmentInfo: null,
      }),
    ).toEqual([]);
  });

  it("orders captures like the operator took them and dedupes urls", () => {
    const gallery = buildIssueGallery({
      issueNumber: 12,
      rawImageUrl: "https://cdn.example/raw-1.png",
      environmentInfo: {
        captured_pages: [
          {
            url: "https://app.example/a",
            title: "Upload video",
            asset_url: "https://cdn.example/raw-1.png",
          },
          {
            url: "https://app.example/b",
            title: "Video details",
            asset_url: "https://cdn.example/raw-2.png",
          },
        ],
      },
      supplementaryAssets: [
        { url: "https://cdn.example/raw-2.png" },
        { url: "https://cdn.example/raw-3.png" },
      ],
    });

    expect(gallery.map((image) => image.src)).toEqual([
      "https://cdn.example/raw-1.png",
      "https://cdn.example/raw-2.png",
      "https://cdn.example/raw-3.png",
    ]);
    expect(gallery[0]).toMatchObject({
      label: "1. Upload video",
      kind: "capture",
    });
    expect(gallery[2]).toMatchObject({
      label: "Screenshot 3",
      kind: "capture",
    });
  });

  it("appends the annotated capture unless it duplicates a raw image", () => {
    const withAnnotation = buildIssueGallery({
      issueNumber: 7,
      rawImageUrl: "https://cdn.example/raw.png",
      annotatedImageUrl: "https://cdn.example/annotated.png",
    });

    expect(withAnnotation.map((image) => image.kind)).toEqual([
      "capture",
      "annotated",
    ]);
    expect(withAnnotation[1]).toMatchObject({
      src: "https://cdn.example/annotated.png",
      label: "Annotated capture",
    });

    const duplicate = buildIssueGallery({
      issueNumber: 7,
      rawImageUrl: "https://cdn.example/raw.png",
      annotatedImageUrl: "https://cdn.example/raw.png",
    });

    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].kind).toBe("capture");
  });
});
