"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DragEvent } from "react";

import type { BoardIssue } from "@/lib/board-types";
import {
  DEFAULT_BOARD_FILTERS,
  SORT_OPTIONS,
  filterIssues,
  sortIssues,
  type BoardFilters,
  type BoardSortMode,
} from "@/lib/board-query";
import type { IssueStatus } from "@/lib/db-types";
import { priorityTier } from "@/lib/priority";

import { BoardFilterPanel } from "./BoardFilterPanel";
import { IssueDetailModal } from "./IssueDetailModal";
import { IssueFormModal } from "./IssueFormModal";
import { ProjectFormModal } from "./ProjectFormModal";
import { ReconsiderModal } from "./ReconsiderModal";

const COLUMNS: Array<{
  status: IssueStatus;
  label: string;
  accent: string;
}> = [
  { status: "draft", label: "Draft", accent: "border-muted" },
  { status: "pending", label: "Pending", accent: "border-teal/40" },
  { status: "working", label: "Working", accent: "border-accent/50" },
  { status: "reconsider", label: "Reconsider", accent: "border-bad/40" },
  { status: "completed", label: "Completed", accent: "border-good/40" },
];

export function KanbanBoard({
  projectName,
  projectKey,
  projectDescription,
  initialIssues,
}: {
  projectName: string;
  projectKey: string;
  projectDescription?: string | null;
  initialIssues: BoardIssue[];
}) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconsiderIssue, setReconsiderIssue] = useState<{
    issue: BoardIssue;
    mode: "developer" | "qa";
  } | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [editingIssue, setEditingIssue] = useState<BoardIssue | null>(null);
  const [confirmDeleteIssueId, setConfirmDeleteIssueId] = useState<
    string | null
  >(null);
  const [deletingIssue, setDeletingIssue] = useState(false);
  const [localProjectName, setLocalProjectName] = useState(projectName);
  const [editingProject, setEditingProject] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_BOARD_FILTERS);
  const [sortModes, setSortModes] = useState<Record<IssueStatus, BoardSortMode>>(
    {
      draft: "manual",
      pending: "manual",
      working: "manual",
      reconsider: "manual",
      completed: "manual",
    },
  );
  const [dropTarget, setDropTarget] = useState<{
    issueId: string;
    position: "before" | "after";
  } | null>(null);

  const filteredIssues = useMemo(
    () => filterIssues(issues, filters),
    [issues, filters],
  );

  function setColumnSort(status: IssueStatus, mode: BoardSortMode) {
    setSortModes((current) => ({ ...current, [status]: mode }));
    setDropTarget(null);
  }

  function manualColumnList(status: IssueStatus, excludeId?: string) {
    return sortIssues(
      issues.filter(
        (issue) => issue.status === status && issue.id !== excludeId,
      ),
      "manual",
    );
  }

  async function persistMove(
    id: string,
    status: IssueStatus,
    previousIssueId: string | null,
    nextIssueId: string | null,
  ) {
    if (status === "reconsider") {
      const issue = issues.find((item) => item.id === id) ?? null;
      setReconsiderIssue(issue ? { issue, mode: "developer" } : null);
      return;
    }

    const previousState = issues;
    const previousIssue = previousIssueId
      ? issues.find((item) => item.id === previousIssueId) ?? null
      : null;
    const nextIssue = nextIssueId
      ? issues.find((item) => item.id === nextIssueId) ?? null
      : null;
    const previousOrder = previousIssue
      ? (previousIssue.board_order ?? previousIssue.issue_number * 1024)
      : null;
    const nextOrder = nextIssue
      ? (nextIssue.board_order ?? nextIssue.issue_number * 1024)
      : null;

    let optimisticOrder: number;
    if (previousOrder !== null && nextOrder !== null) {
      optimisticOrder = (previousOrder + nextOrder) / 2;
    } else if (previousOrder !== null) {
      optimisticOrder = previousOrder + 1;
    } else if (nextOrder !== null) {
      optimisticOrder = nextOrder - 1;
    } else {
      const list = manualColumnList(status, id);
      const last = list[list.length - 1];
      optimisticOrder = last
        ? (last.board_order ?? last.issue_number * 1024) + 1
        : 1024;
    }

    const statusChanged =
      issues.find((item) => item.id === id)?.status !== status;

    setIssues((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              board_order: optimisticOrder,
              ...(statusChanged
                ? { updated_at: new Date().toISOString() }
                : {}),
            }
          : item,
      ),
    );
    setError(null);

    try {
      const response = await fetch(`/api/issues/${id}/position`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          previous_issue_id: previousIssueId,
          next_issue_id: nextIssueId,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { issue?: BoardIssue; error?: { message?: string } }
        | null;

      if (!response.ok || !body?.issue) {
        throw new Error(
          body?.error?.message ?? "Unable to move the issue.",
        );
      }

      const updatedIssue = body.issue;
      setIssues((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...updatedIssue,
                updated_at: String(updatedIssue.updated_at),
                created_at: updatedIssue.created_at
                  ? String(updatedIssue.created_at)
                  : item.created_at,
              }
            : item,
        ),
      );
    } catch (caught) {
      setIssues(previousState);
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to move the issue.",
      );
    }
  }

  function handleColumnDrop(
    event: DragEvent<HTMLDivElement>,
    status: IssueStatus,
  ) {
    if (sortModes[status] !== "manual") {
      return;
    }

    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!id) {
      return;
    }

    const list = manualColumnList(status, id);
    const previous = list[list.length - 1] ?? null;
    void persistMove(id, status, previous?.id ?? null, null);
  }

  function handleCardDrop(
    event: DragEvent<HTMLElement>,
    targetIssue: BoardIssue,
    status: IssueStatus,
    position: "before" | "after",
  ) {
    if (sortModes[status] !== "manual") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDropTarget(null);

    if (!id || id === targetIssue.id) {
      return;
    }

    const list = manualColumnList(status, id);
    const index = list.findIndex((item) => item.id === targetIssue.id);
    if (index === -1) {
      return;
    }

    if (position === "before") {
      const previous = list[index - 1] ?? null;
      void persistMove(id, status, previous?.id ?? null, targetIssue.id);
    } else {
      const next = list[index + 1] ?? null;
      void persistMove(id, status, targetIssue.id, next?.id ?? null);
    }
  }

  async function deleteIssueFromCard(id: string) {
    setDeletingIssue(true);
    setError(null);
    try {
      const response = await fetch(`/api/issues/${id}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Unable to delete the issue.");
      }
      setIssues((current) => current.filter((item) => item.id !== id));
      setConfirmDeleteIssueId(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete the issue.",
      );
    } finally {
      setDeletingIssue(false);
    }
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-line bg-paper p-4 shadow-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent-strong">
            {projectKey} board
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            {localProjectName}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {filteredIssues.length} of {issues.length} issue
            {issues.length === 1 ? "" : "s"} shown · drag cards to reorder ·
            double-click a card to open it
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingProject(true);
              setConfirmDeleteProject(false);
              setProjectError(null);
            }}
            className="rounded-md border border-line-strong px-2 py-1.5 text-xs text-ink-soft transition hover:bg-paper-2"
          >
            Edit project
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteProject(true);
              setEditingProject(false);
              setProjectError(null);
            }}
            className="rounded-md border border-bad/40 px-2 py-1.5 text-xs text-bad transition hover:bg-bad/10"
          >
            Delete project
          </button>
          <button
            type="button"
            onClick={() => setCreatingIssue(true)}
            className="rounded-lg border border-accent bg-accent px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:border-accent-hover hover:bg-accent-hover"
          >
            + New Issue
          </button>
        </div>
      </div>

      <BoardFilterPanel
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_BOARD_FILTERS)}
        resultCount={filteredIssues.length}
        totalCount={issues.length}
      />

      {confirmDeleteProject ? (
        <div className="rounded-md border border-bad/40 bg-bad/10 p-3">
          <p className="text-sm text-bad">
            Delete project {projectKey}? This permanently deletes the project
            and all its issues. This cannot be undone.
          </p>
          {projectError ? (
            <p className="mt-1 text-xs text-bad">{projectError}</p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteProject(false)}
              disabled={deletingProject}
              className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink-soft disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deletingProject}
              onClick={async () => {
                setDeletingProject(true);
                setProjectError(null);
                try {
                  const response = await fetch(
                    `/api/projects/${encodeURIComponent(projectKey)}`,
                    { method: "DELETE" },
                  );
                  const body = (await response
                    .json()
                    .catch(() => null)) as {
                    error?: { message?: string };
                  } | null;
                  if (!response.ok) {
                    setProjectError(
                      body?.error?.message ?? "Unable to delete the project.",
                    );
                    return;
                  }
                  router.push("/dashboard");
                  router.refresh();
                } catch {
                  setProjectError("Unable to reach the server.");
                } finally {
                  setDeletingProject(false);
                }
              }}
              className="rounded-md bg-bad px-3 py-1.5 text-xs font-semibold text-cream disabled:opacity-60"
            >
              {deletingProject ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </div>
      ) : null}

      {editingProject ? (
        <ProjectFormModal
          editing={{
            key: projectKey,
            name: localProjectName,
            description: projectDescription ?? null,
          }}
          onCancel={() => setEditingProject(false)}
          onSaved={(project) => {
            setLocalProjectName(project.name);
            setEditingProject(false);
            router.refresh();
          }}
        />
      ) : null}

      {error ? (
        <p className="rounded-md border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      <div className="flex w-full gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((column) => {
          const sortMode = sortModes[column.status];
          const manualMode = sortMode === "manual";
          const columnIssues = sortIssues(
            filteredIssues.filter(
              (issue) => issue.status === column.status,
            ),
            sortMode,
          );

          return (
            <div
              key={column.status}
              data-status={column.status}
              onDragOver={(event) => {
                if (manualMode) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => handleColumnDrop(event, column.status)}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setDropTarget(null);
                }
              }}
              className={`flex min-w-[220px] flex-1 flex-col rounded-2xl border ${column.accent} bg-paper/80 shadow-sm`}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-soft">
                  {column.label}
                </h2>
                <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[10px] text-muted">
                  {columnIssues.length}
                </span>
              </div>

              <div className="border-b border-line px-2 py-1.5">
                <select
                  aria-label={`Sort ${column.label} column`}
                  value={sortMode}
                  onChange={(event) =>
                    setColumnSort(
                      column.status,
                      event.target.value as BoardSortMode,
                    )
                  }
                  className="w-full rounded border border-line bg-cream px-1.5 py-1 text-[10px] text-ink-soft outline-none focus:border-teal"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!manualMode ? (
                  <p className="mt-1 text-[10px] leading-3 text-muted">
                    Switch to Manual order to drag cards.
                  </p>
                ) : null}
              </div>

              <div className="flex min-h-32 flex-1 flex-col gap-2 p-2">
                {columnIssues.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted">
                    No issues
                  </p>
                ) : (
                  columnIssues.map((issue) => {
                    const tier = priorityTier(issue.priority);

                    return (
                      <article
                        key={issue.id}
                        data-issue-id={issue.id}
                        draggable={manualMode}
                        onDragStart={(event) => {
                          if (!manualMode) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.setData(
                            "text/plain",
                            issue.id,
                          );
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingId(issue.id);
                          setDropTarget(null);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropTarget(null);
                        }}
                        onDragOver={(event) => {
                          if (!manualMode) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          setDropTarget({
                            issueId: issue.id,
                            position:
                              event.clientY < rect.top + rect.height / 2
                                ? "before"
                                : "after",
                          });
                        }}
                        onDrop={(event) => {
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          handleCardDrop(
                            event,
                            issue,
                            column.status,
                            event.clientY < rect.top + rect.height / 2
                              ? "before"
                              : "after",
                          );
                        }}
                        onDoubleClick={(event) => {
                          if (
                            (event.target as HTMLElement).closest(
                              "button, a",
                            )
                          ) {
                            return;
                          }
                          setDetailIssueId(issue.id);
                        }}
                        className={`rounded-xl border p-3 shadow-sm transition ${
                          manualMode ? "cursor-grab" : "cursor-default"
                        } hover:border-accent ${
                          issue.status === "draft"
                            ? "border-dashed border-line-strong bg-cream/60 opacity-80"
                            : "border-line bg-paper"
                        } ${draggingId === issue.id ? "opacity-50" : ""} ${
                          dropTarget?.issueId === issue.id
                            ? "ring-2 ring-accent"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-muted">
                            #{issue.issue_number}
                          </span>
                          <span
                            className={`rounded border border-line-strong px-1.5 py-0.5 text-[10px] ${tier.tone}`}
                          >
                            {tier.label}
                          </span>
                        </div>

                        <h3 className="mt-2 text-sm font-medium text-ink">
                          {issue.title}
                        </h3>

                        {(() => {
                          const primary =
                            issue.annotated_image_url ??
                            issue.raw_image_url ??
                            null;
                          const supplementary = (
                            issue.supplementary_assets ?? []
                          ).map((asset) => asset.url);
                          const all = [
                            ...(primary ? [primary] : []),
                            ...supplementary,
                          ];
                          const visible = all.slice(0, 5);
                          const extra = all.length - visible.length;

                          if (visible.length === 0) {
                            return null;
                          }

                          return (
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              {visible.map((url, index) => (
                                <button
                                  key={`${url}-${index}`}
                                  type="button"
                                  draggable={false}
                                  onDragStart={(event) => event.preventDefault()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDetailIssueId(issue.id);
                                  }}
                                  title="Open issue"
                                  className="h-10 w-10 shrink-0 overflow-hidden rounded border border-line-strong transition hover:border-teal"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt={`Attachment ${index + 1} for issue ${issue.issue_number}`}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                </button>
                              ))}
                              {extra > 0 ? (
                                <span className="rounded border border-line-strong bg-paper-2 px-1.5 py-1 text-[10px] font-semibold text-ink-soft">
                                  MORE +{extra}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                          <span>{issue.report_type}</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {issue.status === "reconsider" ? (
                              <>
                                <span className="rounded-full border border-bad/40 bg-bad/10 px-2 py-0.5 text-bad">
                                  Needs QA
                                </span>
                                <button
                                  type="button"
                                  draggable={false}
                                  onDragStart={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setReconsiderIssue({
                                      issue,
                                      mode: "qa",
                                    });
                                  }}
                                  className="rounded border border-bad/40 px-2 py-0.5 text-bad transition hover:bg-bad/10"
                                >
                                  Reply
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDetailIssueId(issue.id);
                              }}
                              className="rounded border border-line-strong px-2 py-0.5 text-ink-soft transition hover:bg-paper-2"
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingIssue(issue);
                              }}
                              className="rounded border border-line-strong px-2 py-0.5 text-ink-soft transition hover:bg-paper-2"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setConfirmDeleteIssueId(issue.id);
                              }}
                              className="rounded border border-bad/40 px-2 py-0.5 text-bad transition hover:bg-bad/10"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {confirmDeleteIssueId === issue.id ? (
                          <div
                            className="mt-2 rounded-md border border-bad/40 bg-bad/10 p-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <p className="text-[11px] text-bad">
                              Delete #{issue.issue_number} permanently?
                            </p>
                            <div className="mt-1 flex justify-end gap-2">
                              <button
                                type="button"
                                draggable={false}
                                onDragStart={(event) => event.preventDefault()}
                                onClick={() => setConfirmDeleteIssueId(null)}
                                disabled={deletingIssue}
                                className="rounded border border-line-strong px-2 py-0.5 text-[11px] text-ink-soft disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                draggable={false}
                                onDragStart={(event) => event.preventDefault()}
                                onClick={() => void deleteIssueFromCard(issue.id)}
                                disabled={deletingIssue}
                                className="rounded bg-bad px-2 py-0.5 text-[11px] font-semibold text-cream disabled:opacity-60"
                              >
                                {deletingIssue ? "Deleting…" : "Yes, delete"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {reconsiderIssue ? (
        <ReconsiderModal
          issue={reconsiderIssue.issue}
          mode={reconsiderIssue.mode}
          onCancel={() => setReconsiderIssue(null)}
          onSaved={(issue) => {
            setIssues((current) =>
              current.map((item) =>
                item.id === issue.id
                  ? {
                      ...item,
                      status: issue.status,
                      board_order: issue.board_order ?? item.board_order,
                    }
                  : item,
              ),
            );
            setReconsiderIssue(null);
          }}
        />
      ) : null}

      {creatingIssue ? (
        <IssueFormModal
          projectKey={projectKey}
          onCancel={() => setCreatingIssue(false)}
          onSaved={(issue) => {
            const next: BoardIssue = {
              ...issue,
              updated_at:
                typeof (issue as { updated_at?: unknown }).updated_at ===
                "string"
                  ? String(
                      (issue as { updated_at: string }).updated_at,
                    )
                  : new Date().toISOString(),
            };
            setIssues((current) => [next, ...current]);
            setCreatingIssue(false);
          }}
        />
      ) : null}

      {editingIssue ? (
        <IssueFormModal
          projectKey={projectKey}
          editing={editingIssue}
          onCancel={() => setEditingIssue(null)}
          onSaved={(saved) => {
            const next: BoardIssue = {
              ...saved,
              updated_at: String(saved.updated_at),
            };
            setIssues((current) =>
              current.map((item) =>
                item.id === next.id ? { ...item, ...next } : item,
              ),
            );
            setEditingIssue(null);
          }}
        />
      ) : null}

      {detailIssueId ? (
        <IssueDetailModal
          issueId={detailIssueId}
          onClose={() => setDetailIssueId(null)}
          onUpdated={(issue) => {
            setIssues((current) =>
              current.map((item) =>
                item.id === issue.id
                  ? { ...item, ...issue, updated_at: issue.updated_at }
                  : item,
              ),
            );
          }}
          onDeleted={(id) => {
            setIssues((current) =>
              current.filter((item) => item.id !== id),
            );
          }}
        />
      ) : null}
    </div>
  );
}
