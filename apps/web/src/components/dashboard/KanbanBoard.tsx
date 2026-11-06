"use client";

import { useState } from "react";
import type { DragEvent } from "react";

import type { BoardIssue } from "@/lib/board-types";
import type { IssueStatus } from "@/lib/db-types";
import { priorityTier } from "@/lib/priority";

import { IssueDetailModal } from "./IssueDetailModal";
import { ReconsiderModal } from "./ReconsiderModal";

const COLUMNS: Array<{
  status: IssueStatus;
  label: string;
  accent: string;
}> = [
  { status: "draft", label: "Draft", accent: "border-slate-600" },
  { status: "pending", label: "Pending", accent: "border-cyan-500/40" },
  { status: "working", label: "Working", accent: "border-amber-500/40" },
  { status: "reconsider", label: "Reconsider", accent: "border-rose-500/40" },
  { status: "completed", label: "Completed", accent: "border-emerald-500/40" },
];

export function KanbanBoard({
  projectName,
  projectKey,
  initialIssues,
}: {
  projectName: string;
  projectKey: string;
  initialIssues: BoardIssue[];
}) {
  const [issues, setIssues] = useState(initialIssues);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconsiderIssue, setReconsiderIssue] = useState<{
    issue: BoardIssue;
    mode: "developer" | "qa";
  } | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);

  async function moveIssue(id: string, status: IssueStatus) {
    if (status === "reconsider") {
      const issue = issues.find((item) => item.id === id) ?? null;
      setReconsiderIssue(issue ? { issue, mode: "developer" } : null);
      return;
    }

    const previous = issues;
    setIssues((current) =>
      current.map((issue) =>
        issue.id === id ? { ...issue, status } : issue,
      ),
    );
    setError(null);

    try {
      const response = await fetch(`/api/issues/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
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
        current.map((issue) =>
          issue.id === id
            ? {
                ...issue,
                ...updatedIssue,
                updated_at: String(updatedIssue.updated_at),
              }
            : issue,
        ),
      );
    } catch (caught) {
      setIssues(previous);
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to move the issue.",
      );
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, status: IssueStatus) {
    event.preventDefault();
    const id =
      event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (id) {
      void moveIssue(id, status);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            {projectName}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {projectKey} · {issues.length} issue
            {issues.length === 1 ? "" : "s"}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Drag cards between columns. Reconsider requires a note.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((column) => {
          const columnIssues = issues.filter(
            (issue) => issue.status === column.status,
          );

          return (
            <div
              key={column.status}
              data-status={column.status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, column.status)}
              className={`flex w-72 shrink-0 flex-col rounded-xl border ${column.accent} bg-slate-900/40`}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-300">
                  {column.label}
                </h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                  {columnIssues.length}
                </span>
              </div>

              <div className="flex min-h-32 flex-1 flex-col gap-2 p-2">
                {columnIssues.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-600">
                    No issues
                  </p>
                ) : (
                  columnIssues.map((issue) => {
                    const tier = priorityTier(issue.priority);

                    return (
                      <article
                        key={issue.id}
                        data-issue-id={issue.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "text/plain",
                            issue.id,
                          );
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingId(issue.id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        className={`cursor-grab rounded-lg border p-3 transition ${
                          issue.status === "draft"
                            ? "border-dashed border-slate-600 bg-slate-950/50 opacity-80"
                            : "border-slate-700 bg-slate-950/80"
                        } ${draggingId === issue.id ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-slate-500">
                            #{issue.issue_number}
                          </span>
                          <span
                            className={`rounded border border-slate-700 px-1.5 py-0.5 text-[10px] ${tier.tone}`}
                          >
                            {tier.label}
                          </span>
                        </div>

                        <h3 className="mt-2 text-sm font-medium text-slate-100">
                          {issue.title}
                        </h3>

                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>{issue.report_type}</span>
                          <div className="flex items-center gap-2">
                            {issue.status === "reconsider" ? (
                              <>
                                <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-rose-300">
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
                                  className="rounded border border-rose-500/40 px-2 py-0.5 text-rose-200 transition hover:bg-rose-500/10"
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
                              className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition hover:bg-slate-800"
                            >
                              Details
                            </button>
                          </div>
                        </div>
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
                  ? { ...item, status: issue.status }
                  : item,
              ),
            );
            setReconsiderIssue(null);
          }}
        />
      ) : null}

      {detailIssueId ? (
        <IssueDetailModal
          issueId={detailIssueId}
          onClose={() => setDetailIssueId(null)}
        />
      ) : null}
    </div>
  );
}
