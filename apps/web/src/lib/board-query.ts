import type { BoardIssue } from "./board-types";

export type BoardSortMode =
  | "manual"
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "updated_asc"
  | "priority_desc"
  | "priority_asc";

export type DatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "custom";

export interface BoardFilters {
  priorityMin: number;
  priorityMax: number;
  datePreset: DatePreset;
  customFrom: string;
  customTo: string;
}

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export const DEFAULT_BOARD_FILTERS: BoardFilters = {
  priorityMin: 0,
  priorityMax: 100,
  datePreset: "all",
  customFrom: "",
  customTo: "",
};

export const SORT_OPTIONS: Array<{ value: BoardSortMode; label: string }> = [
  { value: "manual", label: "Manual order" },
  { value: "created_desc", label: "Added: newest first" },
  { value: "created_asc", label: "Added: oldest first" },
  { value: "updated_desc", label: "Modified: newest first" },
  { value: "updated_asc", label: "Modified: oldest first" },
  { value: "priority_desc", label: "Priority: high → low" },
  { value: "priority_asc", label: "Priority: low → high" },
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateRangeForPreset(
  preset: DatePreset,
  now: Date = new Date(),
  customFrom = "",
  customTo = "",
): DateRange | null {
  if (preset === "all") {
    return null;
  }

  if (preset === "today") {
    return { from: startOfDay(now), to: endOfDay(now) };
  }

  if (preset === "yesterday") {
    const yesterday = addDays(now, -1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  }

  if (preset === "this_week") {
    const mondayOffset = (now.getDay() + 6) % 7;
    return {
      from: startOfDay(addDays(now, -mondayOffset)),
      to: endOfDay(now),
    };
  }

  if (preset === "this_month") {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: endOfDay(now),
    };
  }

  const from = parseDateInput(customFrom);
  const to = parseDateInput(customTo);

  if (!from && !to) {
    return null;
  }

  return {
    from: from ? startOfDay(from) : null,
    to: to ? endOfDay(to) : null,
  };
}

function issueCreatedAt(issue: BoardIssue): Date | null {
  const value = issue.created_at ?? issue.updated_at;
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function filterIssues(
  issues: BoardIssue[],
  filters: BoardFilters,
  now: Date = new Date(),
): BoardIssue[] {
  const range = dateRangeForPreset(
    filters.datePreset,
    now,
    filters.customFrom,
    filters.customTo,
  );

  return issues.filter((issue) => {
    if (
      issue.priority < filters.priorityMin ||
      issue.priority > filters.priorityMax
    ) {
      return false;
    }

    if (!range) {
      return true;
    }

    const created = issueCreatedAt(issue);
    if (!created) {
      return false;
    }

    if (range.from && created < range.from) {
      return false;
    }
    if (range.to && created > range.to) {
      return false;
    }

    return true;
  });
}

export function activeFilterCount(filters: BoardFilters): number {
  let count = 0;
  if (filters.priorityMin > 0 || filters.priorityMax < 100) {
    count += 1;
  }
  if (
    filters.datePreset !== "all" ||
    filters.customFrom ||
    filters.customTo
  ) {
    count += 1;
  }
  return count;
}

function manualOrder(issue: BoardIssue): number {
  return issue.board_order ?? issue.issue_number * 1024;
}

function timeValue(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortIssues(
  issues: BoardIssue[],
  mode: BoardSortMode,
): BoardIssue[] {
  const sorted = [...issues];

  sorted.sort((a, b) => {
    if (mode === "priority_desc") {
      return b.priority - a.priority || a.issue_number - b.issue_number;
    }
    if (mode === "priority_asc") {
      return a.priority - b.priority || a.issue_number - b.issue_number;
    }
    if (mode === "created_desc") {
      return (
        timeValue(b.created_at) - timeValue(a.created_at) ||
        a.issue_number - b.issue_number
      );
    }
    if (mode === "created_asc") {
      return (
        timeValue(a.created_at) - timeValue(b.created_at) ||
        a.issue_number - b.issue_number
      );
    }
    if (mode === "updated_desc") {
      return (
        timeValue(b.updated_at) - timeValue(a.updated_at) ||
        a.issue_number - b.issue_number
      );
    }
    if (mode === "updated_asc") {
      return (
        timeValue(a.updated_at) - timeValue(b.updated_at) ||
        a.issue_number - b.issue_number
      );
    }

    return manualOrder(a) - manualOrder(b) || a.issue_number - b.issue_number;
  });

  return sorted;
}
