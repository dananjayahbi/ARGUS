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
    <div className="fixed inset-0 z-50 flex flex-col bg-cream">
      <header className="shrink-0 border-b border-teal-hover bg-teal px-6 py-4 text-cream">
        <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
              Issue details
            </p>
            <h2 className="mt-2 truncate text-xl font-semibold text-cream">
              {issue ? issue.title : "Loading…"}
            </h2>
            {issue && data ? (
              <p className="mt-1 text-xs text-teal-tint">
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
                  className="rounded-lg border border-cream/30 px-2 py-1 text-xs font-semibold text-cream transition hover:bg-cream/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(true);
                    setDeleteError(null);
                  }}
                  className="rounded-lg border border-accent/70 px-2 py-1 text-xs font-semibold text-accent transition hover:bg-accent/15"
                >
                  Delete
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close issue details"
              className="rounded-lg border border-cream/30 px-2 py-1 text-xs font-semibold text-cream transition hover:bg-cream/10"
            >
              Close
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
          {confirmDelete && issue ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 p-3">
              <p className="text-sm text-bad">
                Delete issue {projectKey}-{issue.issue_number}? This permanently
                deletes the issue and its notes. This cannot be undone.
              </p>
              {deleteError ? (
                <p className="mt-1 text-xs text-bad">{deleteError}</p>
              ) : null}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink-soft disabled:opacity-60"
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
                  className="rounded-md bg-bad px-3 py-1.5 text-xs font-semibold text-cream disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
              {error}
            </p>
          ) : null}

          {!data && !error ? (
            <p className="text-sm text-muted">Loading issue…</p>
          ) : null}

          {issue && tier ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span
                  className={`rounded border border-line-strong px-2 py-1 ${tier.tone}`}
                >
                  {issue.priority}% · {tier.label}
                </span>
                <span className="text-muted">
                  Updated {new Date(issue.updated_at).toLocaleString()}
                </span>
              </div>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                  Description
                </h3>
                {issue.description ? (
                  <div className="rounded-lg border border-line bg-cream/60 p-3 text-sm text-ink-soft [&_a]:text-teal [&_a]:underline [&_code]:rounded [&_code]:bg-paper-2 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-cream [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:list-disc">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {issue.description}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No description.</p>
                )}
              </section>

              {isTextOnly ? (
                <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
                  Text-only report: no screenshot, annotation canvas or audio
                  was attached.
                </p>
              ) : (
                <>
                  {gallery.length ? (
                    <section className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                          Screenshots ({gallery.length})
                        </h3>
                        <span className="text-[11px] text-muted">
                          Click a screenshot to open the gallery · toggle
                          Annotated / Original · use ← / → to change screenshots
                        </span>
                      </div>
                      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {gallery.map((image, index) => (
                          <li key={image.src}>
                            <button
                              type="button"
                              onClick={() => setPreviewIndex(index)}
                              title={
                                image.versions
                                  ? "Open preview and compare annotated with the original"
                                  : "Open preview"
                              }
                              className="group block w-full overflow-hidden rounded-xl border border-line bg-paper text-left shadow-sm transition hover:border-accent"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={image.src}
                                alt={image.alt}
                                loading="lazy"
                                className="h-40 w-full bg-cream object-cover object-top"
                              />
                              <span className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5">
                                <span className="truncate text-[11px] text-muted transition group-hover:text-teal">
                                  {image.label}
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {image.kind === "annotated" ? (
                                    <span className="rounded-full border border-accent/60 bg-accent-tint px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-strong">
                                      Annotated
                                    </span>
                                  ) : null}
                                  <span className="text-[10px] tabular-nums text-muted">
                                    {index + 1} / {gallery.length}
                                  </span>
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : (
                    <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
                      No screenshot was attached to this issue.
                    </p>
                  )}

                  {issue.audio_note_url ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
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
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                  Diagnostics
                </h3>
                <DiagnosticsDrawer
                  environmentInfo={issue.environment_info}
                  consoleLogs={issue.console_logs}
                />
              </section>

              {fileAssets.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                    Supplementary files
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {fileAssets.map((asset) => (
                      <li
                        key={asset.id}
                        className="overflow-hidden rounded-lg border border-line bg-cream/60 p-2"
                      >
                        <a
                          href={asset.asset_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all text-xs text-teal underline"
                        >
                          {asset.asset_url.split("/").pop()}
                        </a>
                        <span className="text-[11px] text-muted">
                          {asset.asset_type}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                  Reconsider audit trail
                </h3>
                {data?.notes.length ? (
                  <ol className="space-y-3">
                    {data.notes.map((note) => (
                      <li
                        key={note.id}
                        className="rounded-lg border border-line bg-cream/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                          <span className="font-semibold uppercase tracking-wide text-muted">
                            {note.author_role}
                          </span>
                          <span>
                            {new Date(note.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
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
                                  className="text-teal underline"
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
                  <p className="text-sm text-muted">
                    No reconsider notes yet.
                  </p>
                )}
              </section>

              {capturedPages.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                    Captured pages ({capturedPages.length})
                  </h3>
                  <ol className="space-y-2">
                    {capturedPages.map((page, index) => (
                      <li
                        key={`${page.url}-${index}`}
                        className="rounded-lg border border-line bg-cream/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                            {index + 1}
                          </span>
                          {page.kind === "supplementary" ? (
                            <span className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                              supplementary
                            </span>
                          ) : null}
                          {page.title ? (
                            <span className="text-xs font-medium text-ink-soft">
                              {page.title}
                            </span>
                          ) : null}
                          {page.capturedAt ? (
                            <span className="text-[11px] text-muted">
                              {new Date(page.capturedAt).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all text-xs text-teal underline"
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
