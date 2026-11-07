"use client";

import { useState } from "react";

import {
  activeFilterCount,
  type BoardFilters,
  type DatePreset,
} from "@/lib/board-query";

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const dateInputClass =
  "rounded-md border border-line-strong bg-cream px-2 py-1 text-xs text-ink outline-none focus:border-teal";

export function BoardFilterPanel({
  filters,
  onChange,
  onClear,
  resultCount,
  totalCount,
}: {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  onClear: () => void;
  resultCount: number;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = activeFilterCount(filters);

  return (
    <section className="rounded-2xl border border-line bg-paper shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent-strong">
            Filters
          </span>
          {activeCount > 0 ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-ink">
              {activeCount} active
            </span>
          ) : (
            <span className="text-xs text-muted">
              Priority and date filters
            </span>
          )}
          <span className="text-xs text-muted">
            · {resultCount} of {totalCount} issue
            {totalCount === 1 ? "" : "s"} shown
          </span>
        </span>
        <span className="flex items-center gap-2 text-xs text-ink-soft">
          {open ? "Hide" : "Show"}
          <span
            aria-hidden="true"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-line px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-[0.12em] text-muted">
                  Priority range
                </span>
                <span className="tabular-nums text-ink-soft">
                  {filters.priorityMin}% – {filters.priorityMax}%
                </span>
              </div>
              <label className="block text-[11px] text-muted">
                Minimum
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={filters.priorityMin}
                  onChange={(event) =>
                    onChange({
                      ...filters,
                      priorityMin: Math.min(
                        Number(event.target.value),
                        filters.priorityMax,
                      ),
                    })
                  }
                  className="mt-1 w-full accent-teal"
                />
              </label>
              <label className="block text-[11px] text-muted">
                Maximum
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={filters.priorityMax}
                  onChange={(event) =>
                    onChange({
                      ...filters,
                      priorityMax: Math.max(
                        Number(event.target.value),
                        filters.priorityMin,
                      ),
                    })
                  }
                  className="mt-1 w-full accent-teal"
                />
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Date added
              </span>
              <div className="flex flex-wrap gap-1.5">
                {DATE_PRESETS.map((preset) => {
                  const selected = filters.datePreset === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        onChange({ ...filters, datePreset: preset.value })
                      }
                      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                        selected
                          ? "border-teal bg-teal text-cream"
                          : "border-line-strong bg-cream text-ink-soft hover:bg-paper-2"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {filters.datePreset === "custom" ? (
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <label className="space-y-1 text-[11px] text-muted">
                    <span className="block">From</span>
                    <input
                      type="date"
                      value={filters.customFrom}
                      onChange={(event) =>
                        onChange({
                          ...filters,
                          customFrom: event.target.value,
                        })
                      }
                      className={dateInputClass}
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-muted">
                    <span className="block">To</span>
                    <input
                      type="date"
                      value={filters.customTo}
                      onChange={(event) =>
                        onChange({
                          ...filters,
                          customTo: event.target.value,
                        })
                      }
                      className={dateInputClass}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-[11px] text-muted">
              Date filters use the date the issue was added. Sort each column
              independently from its header.
            </p>
            <button
              type="button"
              onClick={onClear}
              disabled={activeCount === 0}
              className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
