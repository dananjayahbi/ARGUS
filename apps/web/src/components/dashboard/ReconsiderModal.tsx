"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import type { BoardIssue } from "@/lib/board-types";

interface NoteView {
  id: string;
  author_role: string;
  note: string;
  attachment_urls: string[] | null;
  created_at: string;
}

const inputClass =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500";

export function ReconsiderModal({
  issue,
  mode,
  onCancel,
  onSaved,
}: {
  issue: BoardIssue;
  mode: "developer" | "qa";
  onCancel: () => void;
  onSaved: (issue: BoardIssue) => void;
}) {
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/issues/${issue.id}/notes`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { notes?: NoteView[] } | null) => {
        if (!cancelled && body?.notes) {
          setNotes(body.notes);
        }
      })
      .catch(() => {
        // The audit trail is supplementary; note submission still works.
      });

    return () => {
      cancelled = true;
    };
  }, [issue.id]);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const urls = [...attachmentUrls];

      for (const file of files) {
        const form = new FormData();
        form.append("category", "reconsider");
        form.append("file", file, file.name);

        const response = await fetch(`/api/uploads?issueId=${issue.id}`, {
          method: "POST",
          body: form,
        });
        const body = (await response.json().catch(() => null)) as
          | {
              url?: string;
              detail?: string;
              error?: { message?: string };
            }
          | null;

        if (!response.ok || !body?.url) {
          throw new Error(
            body?.detail ??
              body?.error?.message ??
              "Attachment upload failed.",
          );
        }

        urls.push(body.url);
      }

      setAttachmentUrls(urls);
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : "Attachment upload failed.",
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!note.trim()) {
      setError("A note is required.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/issues/${issue.id}/reconsider`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          author_role: mode,
          note,
          attachment_urls:
            attachmentUrls.length > 0 ? attachmentUrls : undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        setError(
          body?.error?.message ?? "Unable to save the reconsider note.",
        );
        return;
      }

      onSaved({
        ...issue,
        status: mode === "developer" ? "reconsider" : "working",
      });
    } catch {
      setError("Unable to reach the server.");
    } finally {
      setPending(false);
    }
  }

  const isDeveloper = mode === "developer";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-rose-300">
            {isDeveloper ? "Reconsider" : "QA reply"}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-50">
            {issue.title}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            #{issue.issue_number} ·{" "}
            {isDeveloper
              ? "a developer note is required before this card moves."
              : "reply to the developer's reconsideration note."}
          </p>
        </div>

        {notes.length > 0 ? (
          <div className="max-h-40 space-y-3 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60 p-3">
            {notes.map((item) => (
              <div key={item.id} className="text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-500">
                  <span className="font-semibold uppercase tracking-wide">
                    {item.author_role}
                  </span>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-300">
                  {item.note}
                </p>
                {item.attachment_urls?.length ? (
                  <ul className="mt-1 list-disc pl-4">
                    {item.attachment_urls.map((url) => (
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
              </div>
            ))}
          </div>
        ) : null}

        <label className="block space-y-1 text-xs text-slate-400">
          <span>
            {isDeveloper ? "Developer note (Markdown)" : "QA reply (Markdown)"}
          </span>
          <textarea
            autoFocus
            rows={5}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              isDeveloper
                ? "Why is this blocked, unreproducible or contested?"
                : "Add clarification, reproduction steps or context."
            }
            className={inputClass}
          />
        </label>

        <label className="block space-y-1 text-xs text-slate-400">
          <span>Attachments (optional)</span>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,audio/webm,audio/mp4,audio/wav,audio/ogg"
            onChange={handleFiles}
            disabled={uploading || pending}
            className="block w-full text-xs text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-xs file:text-slate-200"
          />
        </label>

        {uploading ? (
          <p className="text-xs text-slate-400">Uploading attachments…</p>
        ) : null}

        {attachmentUrls.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-cyan-300">
            {attachmentUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {url.split("/").pop()}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {uploadError ? (
          <p className="text-xs text-rose-300">{uploadError}</p>
        ) : null}

        {error ? (
          <p className="text-xs leading-5 text-rose-300">{error}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || uploading}
            className="rounded-md bg-rose-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending
              ? "Saving…"
              : isDeveloper
                ? "Move to Reconsider"
                : "Send reply"}
          </button>
        </div>
      </form>
    </div>
  );
}
