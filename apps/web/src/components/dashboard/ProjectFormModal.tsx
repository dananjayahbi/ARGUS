"use client";

import { useState } from "react";
import type { FormEvent } from "react";

const inputClass =
  "w-full rounded-md border border-line-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-teal";

export function ProjectFormModal({
  editing,
  onCancel,
  onSaved,
}: {
  editing?: { key: string; name: string; description?: string | null };
  onCancel: () => void;
  onSaved: (project: { key: string; name: string }) => void;
}) {
  const isEdit = Boolean(editing);
  const [name, setName] = useState(editing?.name ?? "");
  const [key, setKey] = useState(editing?.key ?? "");
  const [description, setDescription] = useState(
    editing?.description ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!name.trim() || (!isEdit && !key.trim())) {
      setError("Name and key are required.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(
        isEdit ? `/api/projects/${encodeURIComponent(editing!.key)}` : "/api/projects",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isEdit
              ? {
                  name: name.trim(),
                  description: description.trim() || null,
                }
              : {
                  name: name.trim(),
                  key: key.trim().toUpperCase(),
                  description: description.trim() || null,
                },
          ),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | {
            project?: { key: string; name: string };
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !body?.project) {
        setError(body?.error?.message ?? "Unable to save the project.");
        return;
      }

      onSaved(body.project);
    } catch {
      setError("Unable to reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-line-strong bg-paper p-6 shadow-2xl"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-teal">
            {isEdit ? "Edit project" : "New project"}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-ink">
            {isEdit ? `Edit ${editing!.key}` : "Create a project"}
          </h2>
        </div>

        <label className="block space-y-1 text-xs text-muted">
          <span>Name *</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Mobile app"
            maxLength={100}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Key * (immutable, 1–10 chars)</span>
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="e.g. MOB"
            maxLength={10}
            disabled={isEdit}
            className={`${inputClass} disabled:opacity-50`}
          />
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this project about?"
            className={inputClass}
          />
        </label>

        {error ? (
          <p className="rounded-md border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-cream transition hover:bg-teal-hover disabled:opacity-60"
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
