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
