"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ImageLightbox } from "@/components/canvas/ImageLightbox";
import { DiagnosticsDrawer } from "@/components/canvas/DiagnosticsDrawer";
import type { BoardIssue } from "@/lib/board-types";
import { parseCapturedPages } from "@/lib/captured-pages";
import { buildIssueGallery } from "@/lib/issue-gallery";
import { priorityTier } from "@/lib/priority";

import { IssueFormModal } from "./IssueFormModal";

interface DetailNote {
  id: string;
  author_role: string;
  note: string;
  attachment_urls: string[] | null;
  created_at: string;
}

interface SupplementaryAsset {
  id: string;
  asset_url: string;
  asset_type: string;
  created_at: string;
}

interface IssueDetail {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  report_type: string;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  canvas_state: unknown;
  audio_note_url: string | null;
  environment_info: unknown;
  console_logs: unknown;
  created_at: string;
  updated_at: string;
}

interface DetailPayload {
  issue: IssueDetail;
  project: { id: string; key: string; name: string };
  notes: DetailNote[];
  supplementary_assets: SupplementaryAsset[];
}

export function IssueDetailModal({
  issueId,
  onClose,
  onUpdated,
  onDeleted,
}: {
  issueId: string;
  onClose: () => void;
  onUpdated?: (issue: BoardIssue) => void;
  onDeleted?: (id: string) => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/issues/${issueId}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (DetailPayload & { error?: { message?: string } })
          | null;

        if (!response.ok || !body?.issue) {
          throw new Error(
            body?.error?.message ?? "Unable to load this issue.",
          );
        }

        if (!cancelled) {
          setData(body);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load this issue.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [issueId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && previewIndex === null) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, previewIndex]);

  const issue = data?.issue;
  const tier = issue ? priorityTier(issue.priority) : null;
  const isTextOnly = issue?.report_type === "text_only";
  const capturedPages = parseCapturedPages(issue?.environment_info);
  const projectKey = data?.project.key ?? "";

  const imageAssets = useMemo(
    () =>
      (data?.supplementary_assets ?? []).filter((asset) =>
        asset.asset_type.startsWith("image/"),
      ),
    [data?.supplementary_assets],
  );
  const fileAssets = useMemo(
    () =>
      (data?.supplementary_assets ?? []).filter(
        (asset) => !asset.asset_type.startsWith("image/"),
      ),
    [data?.supplementary_assets],
  );

  const gallery = useMemo(() => {
    if (!issue) {
      return [];
    }

    return buildIssueGallery({
      issueNumber: issue.issue_number,
      rawImageUrl: issue.raw_image_url,
      annotatedImageUrl: issue.annotated_image_url,
      environmentInfo: issue.environment_info,
      supplementaryAssets: imageAssets.map((asset) => ({
        url: asset.asset_url,
      })),
    });
  }, [issue, imageAssets]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      <header className="shrink-0 border-b border-slate-800 px-6 py-4">
        <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-400">
              Issue details
            </p>
            <h2 className="mt-2 truncate text-xl font-semibold text-slate-50">
              {issue ? issue.title : "Loading…"}
            </h2>
            {issue && data ? (
              <p className="mt-1 text-xs text-slate-500">
                {projectKey}-{issue.issue_number} · {issue.status} ·{" "}
                {issue.report_type}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {issue ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(true);
                    setDeleteError(null);
                  }}
                  className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 transition hover:bg-rose-500/10"
                >
                  Delete
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close issue details"
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
          {confirmDelete && issue ? (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3">
              <p className="text-sm text-rose-100">
                Delete issue {projectKey}-{issue.issue_number}? This permanently
                deletes the issue and its notes. This cannot be undone.
              </p>
              {deleteError ? (
                <p className="mt-1 text-xs text-rose-200">{deleteError}</p>
              ) : null}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setDeleteError(null);
                    try {
                      const response = await fetch(`/api/issues/${issueId}`, {
                        method: "DELETE",
                      });
                      const body = (await response.json().catch(() => null)) as {
                        error?: { message?: string };
                      } | null;
                      if (!response.ok) {
                        setDeleteError(
                          body?.error?.message ??
                            "Unable to delete the issue.",
                        );
                        return;
                      }
                      onDeleted?.(issueId);
                      onClose();
                    } catch {
                      setDeleteError("Unable to reach the server.");
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          {!data && !error ? (
            <p className="text-sm text-slate-400">Loading issue…</p>
          ) : null}

          {issue && tier ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span
                  className={`rounded border border-slate-700 px-2 py-1 ${tier.tone}`}
                >
                  {issue.priority}% · {tier.label}
                </span>
                <span className="text-slate-500">
                  Updated {new Date(issue.updated_at).toLocaleString()}
                </span>
              </div>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Description
                </h3>
                {issue.description ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300 [&_a]:text-cyan-300 [&_a]:underline [&_code]:rounded [&_code]:bg-slate-800 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-950 [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:list-disc">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {issue.description}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No description.</p>
                )}
              </section>

              {isTextOnly ? (
                <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
                  Text-only report: no screenshot, annotation canvas or audio
                  was attached.
                </p>
              ) : (
                <>
                  {gallery.length ? (
                    <section className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                          Screenshots ({gallery.length})
                        </h3>
                        <span className="text-[11px] text-slate-500">
                          Click a screenshot to open the gallery · use ← / → to
                          change images
                        </span>
                      </div>
                      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {gallery.map((image, index) => (
                          <li key={image.src}>
                            <button
                              type="button"
                              onClick={() => setPreviewIndex(index)}
                              className="group block w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-left transition hover:border-cyan-500/50"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={image.src}
                                alt={image.alt}
                                loading="lazy"
                                className="h-40 w-full bg-slate-950 object-cover object-top"
                              />
                              <span className="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-1.5">
                                <span className="truncate text-[11px] text-slate-400 transition group-hover:text-cyan-300">
                                  {image.label}
                                </span>
                                <span className="shrink-0 text-[10px] tabular-nums text-slate-600">
                                  {index + 1} / {gallery.length}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
                      No screenshot was attached to this issue.
                    </p>
                  )}

                  {issue.audio_note_url ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                        Voice note
                      </h3>
                      <audio
                        controls
                        src={issue.audio_note_url}
                        className="w-full"
                      >
                        <track kind="captions" />
                      </audio>
                    </section>
                  ) : null}
                </>
              )}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Diagnostics
                </h3>
                <DiagnosticsDrawer
                  environmentInfo={issue.environment_info}
                  consoleLogs={issue.console_logs}
                />
              </section>

              {fileAssets.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                    Supplementary files
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {fileAssets.map((asset) => (
                      <li
                        key={asset.id}
                        className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60 p-2"
                      >
                        <a
                          href={asset.asset_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all text-xs text-cyan-300 underline"
                        >
                          {asset.asset_url.split("/").pop()}
                        </a>
                        <span className="text-[11px] text-slate-500">
                          {asset.asset_type}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Reconsider audit trail
                </h3>
                {data?.notes.length ? (
                  <ol className="space-y-3">
                    {data.notes.map((note) => (
                      <li
                        key={note.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-semibold uppercase tracking-wide text-slate-400">
                            {note.author_role}
                          </span>
                          <span>
                            {new Date(note.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                          {note.note}
                        </p>
                        {note.attachment_urls?.length ? (
                          <ul className="mt-1 list-disc pl-4 text-xs">
                            {note.attachment_urls.map((url) => (
                              <li key={url}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-cyan-300 underline"
                                >
                                  {url.split("/").pop()}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-500">
                    No reconsider notes yet.
                  </p>
                )}
              </section>

              {capturedPages.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                    Captured pages ({capturedPages.length})
                  </h3>
                  <ol className="space-y-2">
                    {capturedPages.map((page, index) => (
                      <li
                        key={`${page.url}-${index}`}
                        className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {index + 1}
                          </span>
                          {page.kind === "supplementary" ? (
                            <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                              supplementary
                            </span>
                          ) : null}
                          {page.title ? (
                            <span className="text-xs font-medium text-slate-300">
                              {page.title}
                            </span>
                          ) : null}
                          {page.capturedAt ? (
                            <span className="text-[11px] text-slate-500">
                              {new Date(page.capturedAt).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all text-xs text-cyan-300 underline"
                        >
                          {page.url}
                        </a>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {editing && issue && data ? (
        <IssueFormModal
          projectKey={projectKey}
          editing={{
            id: issue.id,
            issue_number: issue.issue_number,
            title: issue.title,
            priority: issue.priority,
            status: issue.status as BoardIssue["status"],
            report_type: issue.report_type,
            updated_at: issue.updated_at,
            description: issue.description,
            raw_image_url: issue.raw_image_url,
            supplementary_assets: (data?.supplementary_assets ?? []).map(
              (asset) => ({ url: asset.asset_url, asset_type: asset.asset_type }),
            ),
          }}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setData((current) =>
              current
                ? {
                    ...current,
                    issue: {
                      ...current.issue,
                      title: saved.title,
                      description:
                        saved.description !== undefined
                          ? saved.description
                          : current.issue.description,
                      priority: saved.priority,
                      status: saved.status,
                      updated_at: saved.updated_at,
                    },
                  }
                : current,
            );
            onUpdated?.(saved);
          }}
        />
      ) : null}

      {previewIndex !== null && gallery.length ? (
        <ImageLightbox
          images={gallery}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </div>
  );
}
