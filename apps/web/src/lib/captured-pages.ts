/**
 * Helpers for the "captured pages" list shown on an issue.
 *
 * The extension records every screenshot it uploads in
 * `environment_info.captured_pages` (a passthrough field of the environment
 * schema), so an issue with several screenshots can list every page they came
 * from. Older issues only have `environment_info.url`, which is used as a
 * single-entry fallback.
 */

export type CapturedPageKind = "primary" | "supplementary";

export interface CapturedPage {
  url: string;
  title: string | null;
  capturedAt: string | null;
  assetUrl: string | null;
  kind: CapturedPageKind;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCapturedPages(environmentInfo: unknown): CapturedPage[] {
  if (typeof environmentInfo !== "object" || environmentInfo === null) {
    return [];
  }

  const info = environmentInfo as Record<string, unknown>;
  const raw = info.captured_pages;
  const pages: CapturedPage[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const record = item as Record<string, unknown>;
      const url = nonEmptyString(record.url);
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);

      pages.push({
        url,
        title: nonEmptyString(record.title),
        capturedAt: nonEmptyString(record.captured_at),
        assetUrl: nonEmptyString(record.asset_url),
        kind: record.kind === "supplementary" ? "supplementary" : "primary",
      });
    }
  }

  if (pages.length === 0) {
    const url = nonEmptyString(info.url);
    if (url) {
      pages.push({
        url,
        title: nonEmptyString(info.title),
        capturedAt: null,
        assetUrl: null,
        kind: "primary",
      });
    }
  }

  return pages;
}

export interface CaptureImage {
  url: string;
  pageUrl: string | null;
  title: string | null;
  capturedAt: string | null;
  primary: boolean;
}

/**
 * Build the ordered list of screenshots attached to an issue.
 *
 * Primary raw image first, then the supplementary assets stored on the issue,
 * then any captured-page asset URLs resolved from telemetry. Extra URLs (for
 * example a pasted background that has not been uploaded yet) are appended
 * last so the editor can still display and select them.
 */
export function collectCaptureImages({
  environmentInfo,
  primaryUrl,
  supplementaryAssets,
  extraUrls = [],
}: {
  environmentInfo: unknown;
  primaryUrl: string | null | undefined;
  supplementaryAssets: Array<{ url: string }>;
  extraUrls?: string[];
}): CaptureImage[] {
  const pages = parseCapturedPages(environmentInfo);
  const pagesByAsset = new Map<string, CapturedPage>();
  for (const page of pages) {
    if (page.assetUrl) {
      pagesByAsset.set(page.assetUrl, page);
    }
  }

  const candidates: Array<{ url: string; primary: boolean }> = [];
  if (primaryUrl) {
    candidates.push({ url: primaryUrl, primary: true });
  }
  // Prefer telemetry order: the extension records captures in the order the
  // operator took them, which is more meaningful than database insert order.
  for (const page of pages) {
    if (page.assetUrl) {
      candidates.push({ url: page.assetUrl, primary: false });
    }
  }
  for (const asset of supplementaryAssets) {
    if (asset?.url) {
      candidates.push({ url: asset.url, primary: false });
    }
  }
  for (const url of extraUrls) {
    if (url) {
      candidates.push({ url, primary: false });
    }
  }

  const seen = new Set<string>();
  const images: CaptureImage[] = [];
  const fallbackPage = pages[0] ?? null;

  for (const candidate of candidates) {
    if (seen.has(candidate.url)) {
      continue;
    }
    seen.add(candidate.url);

    const page =
      pagesByAsset.get(candidate.url) ??
      (candidate.url === primaryUrl ? fallbackPage : null);

    images.push({
      url: candidate.url,
      pageUrl: page?.url ?? null,
      title: page?.title ?? null,
      capturedAt: page?.capturedAt ?? null,
      primary: candidate.primary,
    });
  }

  return images;
}
