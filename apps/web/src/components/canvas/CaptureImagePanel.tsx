"use client";

import type { CaptureImage } from "@/lib/captured-pages";

interface CaptureImagePanelProps {
  images: CaptureImage[];
  activeUrl: string | null;
  onSelect: (url: string) => void;
}

export function CaptureImagePanel({
  images,
  activeUrl,
  onSelect,
}: CaptureImagePanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
          Attached images
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          {images.length === 0
            ? "No screenshots on this issue."
            : `${images.length} capture${images.length === 1 ? "" : "s"} · select one to annotate`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {images.map((image, index) => {
          const active = image.url === activeUrl;
          return (
            <button
              key={image.url}
              type="button"
              onClick={() => onSelect(image.url)}
              aria-pressed={active}
              title={image.pageUrl ?? image.url}
              className={`group block w-full overflow-hidden rounded-lg border text-left transition ${
                active
                  ? "border-cyan-400 ring-1 ring-cyan-400/60"
                  : "border-slate-800 hover:border-slate-600"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.title ?? `Capture ${index + 1}`}
                className="h-24 w-full bg-slate-950 object-cover object-top"
              />
              <span className="block space-y-0.5 border-t border-slate-800 px-2 py-1.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    #{index + 1}
                    {image.primary ? " · primary" : ""}
                  </span>
                  {active ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                      Editing
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-slate-300">
                  {image.title || image.pageUrl || "Untitled capture"}
                </span>
                {image.pageUrl ? (
                  <span className="block truncate text-[10px] text-slate-500">
                    {image.pageUrl}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}

        {images.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 p-3 text-xs leading-5 text-slate-500">
            Text-only report: there is no screenshot to annotate. You can still
            edit the report fields on the right.
          </p>
        ) : null}
      </div>
    </div>
  );
}
