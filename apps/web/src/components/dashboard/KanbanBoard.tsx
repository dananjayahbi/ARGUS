"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DragEvent } from "react";

import type { BoardIssue } from "@/lib/board-types";
import type { IssueStatus } from "@/lib/db-types";
import { priorityTier } from "@/lib/priority";

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
            {issues.length} issue{issues.length === 1 ? "" : "s"} · drag cards
            between columns
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
          const columnIssues = issues.filter(
            (issue) => issue.status === column.status,
          );

          return (
            <div
              key={column.status}
              data-status={column.status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, column.status)}
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
                        className={`cursor-grab rounded-xl border p-3 shadow-sm transition hover:border-accent ${
                          issue.status === "draft"
                            ? "border-dashed border-line-strong bg-cream/60 opacity-80"
                            : "border-line bg-paper"
                        } ${draggingId === issue.id ? "opacity-50" : ""}`}
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
                  ? { ...item, status: issue.status }
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
