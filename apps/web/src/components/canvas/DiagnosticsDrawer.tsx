"use client";

import { useState } from "react";

interface EnvironmentView {
  url?: string;
  title?: string;
  viewport?: { width?: number; height?: number };
  screen?: { width?: number; height?: number };
  device_pixel_ratio?: number;
  user_agent?: string;
  os?: string;
}

interface ConsoleLogView {
  type: string;
  message: string;
  stack_or_detail?: string | null;
  timestamp?: string;
}

const FILTERS = ["all", "error", "warn", "network_failure"] as const;
type Filter = (typeof FILTERS)[number];

function asEnvironment(value: unknown): EnvironmentView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as EnvironmentView;
}

function asConsoleLogs(value: unknown): ConsoleLogView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ConsoleLogView =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as ConsoleLogView).message === "string",
  );
}

function formatDimensions(value?: { width?: number; height?: number }) {
  if (!value || value.width === undefined || value.height === undefined) {
    return "—";
  }
  return `${value.width} × ${value.height}`;
}

const TYPE_STYLES: Record<string, string> = {
  error: "border-bad/40 bg-bad/10 text-bad",
  warn: "border-accent/50 bg-accent/10 text-accent-strong",
  network_failure: "border-accent/50 bg-accent/10 text-accent-strong",
};

export function DiagnosticsDrawer({
  environmentInfo,
  consoleLogs,
}: {
  environmentInfo: unknown;
  consoleLogs: unknown;
}) {
  const environment = asEnvironment(environmentInfo);
  const logs = asConsoleLogs(consoleLogs);
  const [filter, setFilter] = useState<Filter>("all");
  const filtered =
    filter === "all" ? logs : logs.filter((log) => log.type === filter);

  return (
    <details className="rounded-lg border border-line bg-paper/40">
      <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
        System context &amp; console logs ({logs.length})
      </summary>

      <div className="space-y-4 border-t border-line p-4">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted">Page URL</dt>
            <dd className="break-all text-ink-soft">
              {environment?.url ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Page title</dt>
            <dd className="text-ink-soft">{environment?.title ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Viewport</dt>
            <dd className="text-ink-soft">
              {formatDimensions(environment?.viewport)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Screen</dt>
            <dd className="text-ink-soft">
              {formatDimensions(environment?.screen)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Device pixel ratio</dt>
            <dd className="text-ink-soft">
              {environment?.device_pixel_ratio ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">OS</dt>
            <dd className="text-ink-soft">{environment?.os ?? "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted">User agent</dt>
            <dd className="break-all text-ink-soft">
              {environment?.user_agent ?? "—"}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`rounded-md border px-2 py-1 text-xs capitalize transition ${
                filter === option
                  ? "border-teal/50 bg-teal/10 text-teal"
                  : "border-line-strong text-muted hover:bg-paper-2"
              }`}
            >
              {option === "network_failure" ? "network" : option}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-xs text-muted">
            No harvested console or network errors for this filter.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((log, index) => (
              <li
                key={`${log.timestamp ?? "log"}-${index}`}
                className="rounded-md border border-line bg-cream/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      TYPE_STYLES[log.type] ??
                      "border-line-strong bg-paper-2 text-ink-soft"
                    }`}
                  >
                    {log.type}
                  </span>
                  <span className="text-[11px] text-muted">
                    {log.timestamp ?? "no timestamp"}
                  </span>
                </div>
                <p className="mt-2 break-words text-xs text-ink-soft">
                  {log.message}
                </p>
                {log.stack_or_detail ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-paper p-2 text-[11px] text-muted">
                    {log.stack_or_detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
