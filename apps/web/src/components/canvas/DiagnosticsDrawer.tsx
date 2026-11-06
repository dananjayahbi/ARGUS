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
  error: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  network_failure: "border-violet-500/40 bg-violet-500/10 text-violet-300",
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
    <details className="rounded-lg border border-slate-800 bg-slate-900/40">
      <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
        System context &amp; console logs ({logs.length})
      </summary>

      <div className="space-y-4 border-t border-slate-800 p-4">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-slate-500">Page URL</dt>
            <dd className="break-all text-slate-300">
              {environment?.url ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Page title</dt>
            <dd className="text-slate-300">{environment?.title ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Viewport</dt>
            <dd className="text-slate-300">
              {formatDimensions(environment?.viewport)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Screen</dt>
            <dd className="text-slate-300">
              {formatDimensions(environment?.screen)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Device pixel ratio</dt>
            <dd className="text-slate-300">
              {environment?.device_pixel_ratio ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">OS</dt>
            <dd className="text-slate-300">{environment?.os ?? "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate-500">User agent</dt>
            <dd className="break-all text-slate-300">
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
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                  : "border-slate-700 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {option === "network_failure" ? "network" : option}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500">
            No harvested console or network errors for this filter.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((log, index) => (
              <li
                key={`${log.timestamp ?? "log"}-${index}`}
                className="rounded-md border border-slate-800 bg-slate-950/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      TYPE_STYLES[log.type] ??
                      "border-slate-700 bg-slate-800 text-slate-300"
                    }`}
                  >
                    {log.type}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {log.timestamp ?? "no timestamp"}
                  </span>
                </div>
                <p className="mt-2 break-words text-xs text-slate-200">
                  {log.message}
                </p>
                {log.stack_or_detail ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-400">
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
