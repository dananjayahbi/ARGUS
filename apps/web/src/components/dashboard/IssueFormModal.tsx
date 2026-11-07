"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { BoardIssue } from "@/lib/board-types";
import type { IssueStatus } from "@/lib/db-types";
import { priorityTier } from "@/lib/priority";

const inputClass =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500";

const STATUS_OPTIONS: Array<{ value: IssueStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "working", label: "Working" },
  { value: "completed", label: "Completed" },
];

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

interface AttachedImage {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  type: string;
}

type EditingIssue = BoardIssue & {
  description?: string | null;
  raw_image_url?: string | null;
  supplementary_assets?: Array<{ url: string; asset_type: string }>;
};

function imageFilesFromList(list: FileList | File[] | null): File[] {
  if (!list) {
    return [];
  }
  return Array.from(list).filter((file) => IMAGE_TYPES.has(file.type));
}

export function IssueFormModal({
  projectKey,
  editing,
  onCancel,
  onSaved,
}: {
  projectKey: string;
  editing?: EditingIssue;
  onCancel: () => void;
  onSaved: (issue: BoardIssue & { description?: string | null }) => void;
}) {
  const isEdit = Boolean(editing);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [priority, setPriority] = useState(editing?.priority ?? 50);
  const [status, setStatus] = useState<IssueStatus>(
    editing?.status === "reconsider"
      ? "working"
      : editing?.status ?? "pending",
  );
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingRawUrl = editing?.raw_image_url ?? null;
  const existingSupplementary = editing?.supplementary_assets ?? [];

  const addFiles = useCallback((files: File[]) => {
    setImageError(null);

    const valid: AttachedImage[] = [];
    for (const file of files) {
      if (!IMAGE_TYPES.has(file.type)) {
        setImageError(
          `"${file.name}" is not a PNG, JPG or WebP image and was skipped.`,
        );
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError(
          `"${file.name}" is larger than 50 MB and was skipped.`,
        );
        continue;
      }
      valid.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        type: file.type,
      });
    }

    if (valid.length > 0) {
      setImages((current) => [...current, ...valid]);
    } else if (files.length > 0) {
      setImageError(
        "No accepted images were found. Use PNG, JPG or WebP up to 50 MB.",
      );
    }
  }, []);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = imageFilesFromList(
        event.clipboardData ? Array.from(event.clipboardData.files) : null,
      );
      if (files.length > 0) {
        event.preventDefault();
        addFiles(files);
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addFiles]);

  useEffect(() => {
    return () => {
      for (const image of images) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
    // Only revoke on unmount; images are replaced on change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function removeImage(id: string) {
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((image) => image.id !== id);
    });
  }

  async function uploadOne(file: File, category: string): Promise<string> {
    const form = new FormData();
    form.append("category", category);
    form.append("file", file, file.name);

    const response = await fetch("/api/uploads", {
      method: "POST",
      body: form,
    });
    const body = (await response.json().catch(() => null)) as
      | { url?: string; detail?: string; error?: { message?: string } }
      | null;

    if (!response.ok || !body?.url) {
      throw new Error(
        body?.detail ??
          body?.error?.message ??
          "Image upload failed. Check that the CDN is running.",
      );
    }

    return body.url;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setPending(true);
    setError(null);
    setImageError(null);

    try {
      let rawImageUrl: string | null = null;
      const supplementaryAssets: Array<{ url: string; asset_type: string }> = [];

      if (images.length > 0) {
        const [first, ...rest] = images;
        setUploadPhase(
          `Uploading screenshot (${first.name}) to the CDN…`,
        );
        rawImageUrl = await uploadOne(first.file, "raw");

        for (const [index, image] of rest.entries()) {
          setUploadPhase(
            `Uploading attachment ${index + 1} of ${rest.length} (${image.name})…`,
          );
          const url = await uploadOne(image.file, "reconsider");
          supplementaryAssets.push({
            url,
            asset_type: image.type || "image/png",
          });
        }
        setUploadPhase(null);
      }

      const hasImages = images.length > 0;
      const url = isEdit ? `/api/issues/${editing!.id}` : "/api/issues";
      const payload = isEdit
        ? {
            title: title.trim(),
            description: description.trim() || null,
            priority,
            status,
            ...(hasImages
              ? {
                  raw_image_url: rawImageUrl,
                  report_type: "screenshot" as const,
                  supplementary_assets: [
                    ...existingSupplementary,
                    ...supplementaryAssets,
                  ],
                }
              : {}),
          }
        : {
            project_key: projectKey,
            title: title.trim(),
            description: description.trim() || null,
            priority,
            status,
            report_type: hasImages ? ("screenshot" as const) : ("text_only" as const),
            ...(hasImages
              ? {
                  raw_image_url: rawImageUrl,
                  supplementary_assets: supplementaryAssets,
                }
              : {}),
          };

      const response = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            issue?: BoardIssue & {
              description?: string | null;
              updated_at?: string | Date;
            };
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !body?.issue) {
        setError(body?.error?.message ?? "Unable to save the issue.");
        return;
      }

      const { updated_at, ...rest } = body.issue as BoardIssue & {
        description?: string | null;
        updated_at?: string | Date;
      };
      onSaved({
        ...rest,
        raw_image_url: hasImages
          ? (rawImageUrl ?? null)
          : (existingRawUrl ?? null),
        supplementary_assets: hasImages
          ? [...existingSupplementary, ...supplementaryAssets]
          : (existingSupplementary.length > 0
              ? existingSupplementary
              : []),
        updated_at:
          typeof updated_at === "string"
            ? updated_at
            : new Date().toISOString(),
      });
    } catch (caught) {
      setImageError(null);
      setUploadPhase(null);
      setError(
        caught instanceof Error ? caught.message : "Unable to reach the server.",
      );
    } finally {
      setPending(false);
      setUploadPhase(null);
    }
  }

  const tier = priorityTier(priority);
  const totalImages =
    (existingRawUrl ? 1 : 0) +
    existingSupplementary.length +
    images.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
            {isEdit ? "Edit issue" : "New issue"}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-50">
            {isEdit
              ? `${projectKey}-${editing!.issue_number} · ${editing!.title}`
              : `Create an issue in ${projectKey}`}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {isEdit
              ? "Edit title, description, priority, status or screenshot. Reconsider still requires a note from the board."
              : "Manual issue. Attach a screenshot, or go text-only."}
          </p>
        </div>

        <label className="block space-y-1 text-xs text-slate-400">
          <span>Title *</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Checkout total is wrong"
            maxLength={255}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1 text-xs text-slate-400">
          <span>Description (Markdown)</span>
          <textarea
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Steps to reproduce, expected vs actual…"
            className={inputClass}
          />
        </label>

        <div className="space-y-2">
          <span className="block text-xs text-slate-400">
            Screenshots &amp; attachments
            {totalImages > 0 ? ` — ${totalImages} attached` : ""}
          </span>

          <div
            role="button"
            tabIndex={0}
            aria-label="Drop images to attach, or click to choose files"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addFiles(
                imageFilesFromList(
                  event.dataTransfer ? Array.from(event.dataTransfer.files) : null,
                ),
              );
            }}
            className={`rounded-lg border-2 border-dashed p-5 text-center transition ${
              dragActive
                ? "border-cyan-400 bg-cyan-500/10"
                : "border-slate-700 bg-slate-950/50 hover:border-slate-500"
            }`}
          >
            <p className="text-sm font-medium text-slate-200">
              Drag &amp; drop images here
            </p>
            <p className="mt-1 text-xs text-slate-500">
              or click to choose files from your PC, or paste (Ctrl+V) a
              screenshot. PNG, JPG or WebP up to 50 MB each.
            </p>
            <p className="mt-2 text-[11px] text-slate-600">
              The first image becomes the issue screenshot. Extra images are
              stored as attachments via the CDN.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(imageFilesFromList(event.target.files));
              event.target.value = "";
            }}
          />

          {(existingRawUrl || existingSupplementary.length > 0) && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">Already attached:</p>
              <div className="flex flex-wrap gap-2">
                {existingRawUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={existingRawUrl}
                    alt="Current screenshot"
                    className="h-16 w-16 rounded-md border border-slate-700 object-cover"
                  />
                )}
                {existingSupplementary.map((asset, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${asset.url}-${index}`}
                    src={asset.url}
                    alt={`Attachment ${index + 1}`}
                    className="h-16 w-16 rounded-md border border-slate-700 object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          {images.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                New images ({images.length}): first becomes the screenshot.
              </p>
              <div className="flex flex-wrap gap-2">
                {images.map((image) => (
                  <div key={image.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-16 w-16 rounded-md border border-cyan-500/50 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      aria-label={`Remove ${image.name}`}
                      className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-950"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {imageError && (
            <p className="text-xs text-rose-300">{imageError}</p>
          )}
          {uploadPhase && (
            <p className="text-xs text-cyan-300">{uploadPhase}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-xs text-slate-400">
            <span>Priority: {priority}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              className="w-full accent-cyan-500"
            />
            <span className={tier.tone}>{tier.label}</span>
          </label>

          <label className="block space-y-1 text-xs text-slate-400">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as IssueStatus)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending
              ? uploadPhase
                ? "Uploading…"
                : "Saving…"
              : isEdit
                ? "Save changes"
                : "Create issue"}
          </button>
        </div>
      </form>
    </div>
  );
}
