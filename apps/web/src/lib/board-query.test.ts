import { describe, expect, it } from "vitest";

import type { BoardIssue } from "./board-types";
import {
  DEFAULT_BOARD_FILTERS,
  activeFilterCount,
  dateRangeForPreset,
  filterIssues,
  sortIssues,
} from "./board-query";

const NOW = new Date(2026, 10, 7, 12, 0, 0);

function issue(overrides: Partial<BoardIssue> = {}): BoardIssue {
  return {
    id: overrides.id ?? "id",
    issue_number: overrides.issue_number ?? 1,
    title: overrides.title ?? "Issue",
    priority: overrides.priority ?? 50,
    status: overrides.status ?? "pending",
    report_type: overrides.report_type ?? "text_only",
    updated_at: overrides.updated_at ?? new Date(2026, 10, 7, 9).toISOString(),
    created_at: overrides.created_at ?? new Date(2026, 10, 7, 8).toISOString(),
    board_order: overrides.board_order,
  };
}

describe("dateRangeForPreset", () => {
  it("returns null for the all-time preset", () => {
    expect(dateRangeForPreset("all", NOW)).toBeNull();
  });

  it("covers the current day", () => {
    const range = dateRangeForPreset("today", NOW)!;
    expect(range.from).toEqual(new Date(2026, 10, 7, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 10, 7, 23, 59, 59, 999));
  });

  it("covers yesterday only", () => {
    const range = dateRangeForPreset("yesterday", NOW)!;
    expect(range.from).toEqual(new Date(2026, 10, 6, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 10, 6, 23, 59, 59, 999));
  });

  it("starts this week on Monday", () => {
    const range = dateRangeForPreset("this_week", NOW)!;
    expect(range.from).toEqual(new Date(2026, 10, 2, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 10, 7, 23, 59, 59, 999));
  });

  it("starts this month on the first", () => {
    const range = dateRangeForPreset("this_month", NOW)!;
    expect(range.from).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0));
  });

  it("parses a custom range as local dates", () => {
    const range = dateRangeForPreset(
      "custom",
      NOW,
      "2026-11-03",
      "2026-11-05",
    )!;
    expect(range.from).toEqual(new Date(2026, 10, 3, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 10, 5, 23, 59, 59, 999));
  });
});

describe("filterIssues", () => {
  const issues = [
    issue({
      id: "old",
      issue_number: 1,
      priority: 20,
      created_at: new Date(2026, 9, 20, 8).toISOString(),
    }),
    issue({
      id: "today-high",
      issue_number: 2,
      priority: 90,
      created_at: new Date(2026, 10, 7, 8).toISOString(),
    }),
    issue({
      id: "today-low",
      issue_number: 3,
      priority: 10,
      created_at: new Date(2026, 10, 7, 9).toISOString(),
    }),
  ];

  it("returns everything with default filters", () => {
    expect(filterIssues(issues, DEFAULT_BOARD_FILTERS, NOW)).toHaveLength(3);
  });

  it("filters by priority range", () => {
    const result = filterIssues(
      issues,
      { ...DEFAULT_BOARD_FILTERS, priorityMin: 50, priorityMax: 100 },
      NOW,
    );
    expect(result.map((item) => item.id)).toEqual(["today-high"]);
  });

  it("filters by a date preset", () => {
    const result = filterIssues(
      issues,
      { ...DEFAULT_BOARD_FILTERS, datePreset: "today" },
      NOW,
    );
    expect(result.map((item) => item.id)).toEqual(["today-high", "today-low"]);
  });

  it("counts active filter groups", () => {
    expect(activeFilterCount(DEFAULT_BOARD_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_BOARD_FILTERS,
        priorityMin: 20,
        datePreset: "this_week",
      }),
    ).toBe(2);
  });
});

describe("sortIssues", () => {
  const issues = [
    issue({
      id: "middle",
      issue_number: 2,
      priority: 50,
      created_at: new Date(2026, 10, 5, 8).toISOString(),
      updated_at: new Date(2026, 10, 6, 8).toISOString(),
      board_order: 2000,
    }),
    issue({
      id: "first",
      issue_number: 3,
      priority: 90,
      created_at: new Date(2026, 10, 7, 8).toISOString(),
      updated_at: new Date(2026, 10, 5, 8).toISOString(),
      board_order: 1000,
    }),
    issue({
      id: "last",
      issue_number: 1,
      priority: 10,
      created_at: new Date(2026, 10, 4, 8).toISOString(),
      updated_at: new Date(2026, 10, 7, 8).toISOString(),
      board_order: 3000,
    }),
  ];

  it("keeps manual board order by default", () => {
    expect(sortIssues(issues, "manual").map((item) => item.id)).toEqual([
      "first",
      "middle",
      "last",
    ]);
  });

  it("sorts by priority in both directions", () => {
    expect(sortIssues(issues, "priority_desc").map((item) => item.id)).toEqual([
      "first",
      "middle",
      "last",
    ]);
    expect(sortIssues(issues, "priority_asc").map((item) => item.id)).toEqual([
      "last",
      "middle",
      "first",
    ]);
  });

  it("sorts by added and modified dates", () => {
    expect(sortIssues(issues, "created_desc").map((item) => item.id)).toEqual([
      "first",
      "middle",
      "last",
    ]);
    expect(sortIssues(issues, "updated_desc").map((item) => item.id)).toEqual([
      "last",
      "middle",
      "first",
    ]);
  });
});
