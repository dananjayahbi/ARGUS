"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { DiagnosticsDrawer } from "@/components/canvas/DiagnosticsDrawer";
import { priorityTier } from "@/lib/priority";

import { ReadOnlyCanvas } from "./ReadOnlyCanvas";

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
}: {
  issueId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"raw" | "annotated">("annotated");

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
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const issue = data?.issue;
  const tier = issue ? priorityTier(issue.priority) : null;
  const hasImage = Boolean(issue?.raw_image_url || issue?.annotated_image_url);
  const isTextOnly = issue?.report_type === "text_only";
  const activeImageUrl =
    imageMode === "annotated"
      ? issue?.annotated_image_url ?? issue?.raw_image_url ?? null
      : issue?.raw_image_url ?? issue?.annotated_image_url ?? null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={issue ? `Issue ${issue.issue_number}` : "Issue details"}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-400">
              Issue details
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-50">
              {issue ? issue.title : "Loading…"}
            </h2>
            {issue && data ? (
              <p className="mt-1 text-xs text-slate-500">
                {data.project.key}-{issue.issue_number} · {issue.status} ·{" "}
                {issue.report_type}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close issue details"
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        {error ? (
          <p className="mt-6 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {!data && !error ? (
          <p className="mt-6 text-sm text-slate-400">Loading issue…</p>
        ) : null}

        {issue && tier ? (
          <div className="mt-6 space-y-6">
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
                Text-only report: no screenshot, annotation canvas or audio was
                attached.
              </p>
            ) : (
              <>
                {hasImage ? (
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                        Screenshot
                      </h3>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setImageMode("raw")}
                          aria-pressed={imageMode === "raw"}
                          disabled={!issue.raw_image_url}
                          className={`rounded px-2 py-1 text-xs transition disabled:opacity-40 ${
                            imageMode === "raw"
                              ? "bg-slate-800 text-slate-100"
                              : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          Raw
                        </button>
                        <button
                          type="button"
                          onClick={() => setImageMode("annotated")}
                          aria-pressed={imageMode === "annotated"}
                          disabled={!issue.annotated_image_url}
                          className={`rounded px-2 py-1 text-xs transition disabled:opacity-40 ${
                            imageMode === "annotated"
                              ? "bg-slate-800 text-slate-100"
                              : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          Annotated
                        </button>
                      </div>
                    </div>

                    {activeImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeImageUrl}
                        alt={`${imageMode} capture for issue ${issue.issue_number}`}
                        className="max-h-96 w-full rounded-lg border border-slate-800 bg-slate-950 object-contain"
                      />
                    ) : (
                      <p className="text-sm text-slate-500">
                        No {imageMode} image is available.
                      </p>
                    )}
                  </section>
                ) : (
                  <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
                    No screenshot was attached to this issue.
                  </p>
                )}

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                    Vector annotations (read-only)
                  </h3>
                  <ReadOnlyCanvas
                    canvasState={issue.canvas_state}
                    fallbackImageUrl={
                      issue.raw_image_url ?? issue.annotated_image_url
                    }
                  />
                </section>

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

            {data?.supplementary_assets.length ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Supplementary assets
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {data.supplementary_assets.map((asset) => (
                    <li
                      key={asset.id}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 p-2"
                    >
                      <a
                        href={asset.asset_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs text-cyan-300 underline"
                      >
                        {asset.asset_url.split("/").pop()}
                      </a>
                      <span className="text-[11px] text-slate-500">
                        {asset.asset_type}
                      </span>
                      {asset.asset_type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.asset_url}
                          alt="Supplementary asset"
                          className="mt-2 max-h-40 w-full rounded object-contain"
                        />
                      ) : null}
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
