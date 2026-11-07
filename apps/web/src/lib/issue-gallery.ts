/**
 * Build the screenshot gallery shown in the issue detail modal.
 *
 * Captures are ordered the way the operator took them: the primary raw image
 * first, then the supplementary assets, resolved against the capture telemetry
 * (`environment_info.captured_pages`) when it is available.
 *
 * The annotated image is a flattened version of the primary capture. Rather
 * than showing it as a separate, duplicated screenshot, it becomes the
 * preferred version of that capture; the lightbox then lets the operator toggle
 * back to the untouched original.
 */

import { collectCaptureImages } from "./captured-pages";

export type IssueGalleryKind = "capture" | "annotated";

export interface IssueGalleryVersion {
  src: string;
  label: string;
}

export interface IssueGalleryImage {
  src: string;
  alt: string;
  title: string;
  label: string;
  kind: IssueGalleryKind;
  versions?: IssueGalleryVersion[];
}

export function buildIssueGallery({
  issueNumber,
  rawImageUrl,
  annotatedImageUrl,
  environmentInfo,
  supplementaryAssets = [],
}: {
  issueNumber: number;
  rawImageUrl?: string | null;
  annotatedImageUrl?: string | null;
  environmentInfo?: unknown;
  supplementaryAssets?: Array<{ url: string }>;
}): IssueGalleryImage[] {
  const captures = collectCaptureImages({
    environmentInfo,
    primaryUrl: rawImageUrl,
    supplementaryAssets,
  });

  const gallery: IssueGalleryImage[] = captures.map((capture, index) => {
    const name = capture.title?.trim() || `Screenshot ${index + 1}`;
    return {
      src: capture.url,
      alt: `${name} (issue ${issueNumber})`,
      title: `Issue ${issueNumber} · ${name}`,
      label: capture.title
        ? `${index + 1}. ${capture.title}`
        : `Screenshot ${index + 1}`,
      kind: "capture",
    };
  });

  if (!annotatedImageUrl) {
    return gallery;
  }

  if (gallery.some((image) => image.src === annotatedImageUrl)) {
    return gallery;
  }

  // The annotated PNG is flattened from the primary capture. Pair them so the
  // gallery shows one entry per screenshot, with the annotated version first.
  const primaryIndex = 0;
  const primary = gallery[primaryIndex];

  if (primary) {
    gallery[primaryIndex] = {
      ...primary,
      src: annotatedImageUrl,
      kind: "annotated",
      versions: [
        { src: annotatedImageUrl, label: "Annotated" },
        { src: primary.src, label: "Original" },
      ],
    };
    return gallery;
  }

  return [
    ...gallery,
    {
      src: annotatedImageUrl,
      alt: `Annotated capture (issue ${issueNumber})`,
      title: `Issue ${issueNumber} · Annotated capture`,
      label: "Annotated capture",
      kind: "annotated",
    },
  ];
}
