/**
 * Build the screenshot gallery shown in the issue detail modal.
 *
 * Captures are ordered the way the operator took them: the primary raw image
 * first, then the supplementary assets, resolved against the capture telemetry
 * (`environment_info.captured_pages`) when it is available. The annotated image
 * is a derived asset, so it is appended last as its own entry.
 */

import { collectCaptureImages } from "./captured-pages";

export type IssueGalleryKind = "capture" | "annotated";

export interface IssueGalleryImage {
  src: string;
  alt: string;
  title: string;
  label: string;
  kind: IssueGalleryKind;
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

  if (
    annotatedImageUrl &&
    !gallery.some((image) => image.src === annotatedImageUrl)
  ) {
    gallery.push({
      src: annotatedImageUrl,
      alt: `Annotated capture (issue ${issueNumber})`,
      title: `Issue ${issueNumber} · Annotated capture`,
      label: "Annotated capture",
      kind: "annotated",
    });
  }

  return gallery;
}
