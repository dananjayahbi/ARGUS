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

  it("prefers the annotated image inside the primary capture instead of duplicating it", () => {
    const gallery = buildIssueGallery({
      issueNumber: 7,
      rawImageUrl: "https://cdn.example/raw-1.png",
      annotatedImageUrl: "https://cdn.example/annotated.png",
      supplementaryAssets: [{ url: "https://cdn.example/raw-2.png" }],
    });

    expect(gallery).toHaveLength(2);
    expect(gallery[0]).toMatchObject({
      src: "https://cdn.example/annotated.png",
      kind: "annotated",
    });
    expect(gallery[0].versions).toEqual([
      { src: "https://cdn.example/annotated.png", label: "Annotated" },
      { src: "https://cdn.example/raw-1.png", label: "Original" },
    ]);
    expect(gallery[1]).toMatchObject({
      src: "https://cdn.example/raw-2.png",
      kind: "capture",
    });
  });

  it("keeps a single entry when the annotated url duplicates a raw capture", () => {
    const duplicate = buildIssueGallery({
      issueNumber: 7,
      rawImageUrl: "https://cdn.example/raw.png",
      annotatedImageUrl: "https://cdn.example/raw.png",
    });

    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].kind).toBe("capture");
    expect(duplicate[0].versions).toBeUndefined();
  });

  it("shows an annotated-only issue without inventing an original", () => {
    const annotatedOnly = buildIssueGallery({
      issueNumber: 9,
      rawImageUrl: null,
      annotatedImageUrl: "https://cdn.example/annotated.png",
    });

    expect(annotatedOnly).toEqual([
      expect.objectContaining({
        src: "https://cdn.example/annotated.png",
        kind: "annotated",
      }),
    ]);
    expect(annotatedOnly[0].versions).toBeUndefined();
  });
});
