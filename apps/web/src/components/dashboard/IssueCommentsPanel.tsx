"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  ImageLightbox,
  type LightboxImage,
} from "@/components/canvas/ImageLightbox";
import { VoiceRecorder } from "@/components/canvas/VoiceRecorder";
import { audioExtension } from "@/lib/audio";

export interface CommentAttachment {
  id: string;
  url: string;
  asset_type: string;
  file_name: string | null;
  size_bytes: number | null;
  created_at?: string;
}

export interface IssueComment {
  id: string;
  author_user_id: string | null;
  author_role: "developer" | "qa";
  body: string;
  created_at: string;
  attachments: CommentAttachment[];
}

interface Viewer {
  id: string;
  email: string;
  role: "developer" | "qa";
}

interface StagedAttachment {
  id: string;
  file: File;
  uploadType: string;
  previewUrl: string | null;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "md",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
]);

const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "application/pdf",
  ".txt",
  ".log",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
].join(",");

const ROLE_LABEL: Record<"developer" | "qa", string> = {
  developer: "Developer",
  qa: "QA",
};

const ROLE_BADGE: Record<"developer" | "qa", string> = {
  developer: "border-teal/40 bg-teal/10 text-teal",
  qa: "border-accent/60 bg-accent-tint text-accent-strong",
};

function commentElementId(issueId: string, commentId: string) {
  return `comment-${issueId}-${commentId}`;
}

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

function resolveUploadType(file: File): string | null {
  if (IMAGE_TYPES.has(file.type) || AUDIO_TYPES.has(file.type)) {
    return file.type;
  }
  if (file.type === "application/pdf") {
    return "application/pdf";
  }
  if (
    file.type === "text/plain" ||
    file.type === "text/csv" ||
    file.type === "application/json" ||
    file.type === "application/xml"
  ) {
    return "text/plain";
  }

  const extension = fileExtension(file.name);
  if (extension === "pdf") {
    return "application/pdf";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text/plain";
  }

  return null;
}

function categoryForType(uploadType: string): "reconsider" | "audio" | "files" {
  if (AUDIO_TYPES.has(uploadType)) {
    return "audio";
  }
  if (IMAGE_TYPES.has(uploadType)) {
    return "reconsider";
  }
  return "files";
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function IssueCommentsPanel({
  issueId,
  focusCommentId,
  onCommentPosted,
}: {
  issueId: string;
  focusCommentId?: string | null;
  onCommentPosted?: (comment: IssueComment) => void;
}) {
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [voice, setVoice] = useState<{ blob: Blob; mime: string } | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stagedRef = useRef<StagedAttachment[]>([]);
  const focusAppliedRef = useRef(false);

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/issues/${issueId}/comments`);
      const payload = (await response.json().catch(() => null)) as
        | {
            viewer?: Viewer;
            comments?: IssueComment[];
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.comments) {
        setLoadError(
          payload?.error?.message ?? "Unable to load the conversation.",
        );
        return;
      }

      setLoadError(null);
      setViewer(payload.viewer ?? null);
      setComments(payload.comments);
    } catch {
      setLoadError("Unable to reach the server.");
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const element = listRef.current;
    if (!element) {
      return;
    }

    if (focusCommentId && !focusAppliedRef.current) {
      focusAppliedRef.current = true;
      const target = document.getElementById(
        commentElementId(issueId, focusCommentId),
      );
      if (target) {
        target.scrollIntoView({ block: "center" });
        window.setTimeout(() => {
          setHighlightId(focusCommentId);
          window.setTimeout(() => setHighlightId(null), 4000);
        }, 0);
        return;
      }
    }

    element.scrollTop = element.scrollHeight;
  }, [comments, focusCommentId, issueId, loading]);

  useEffect(() => {
    return () => {
      for (const item of stagedRef.current) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, []);

  function addFiles(files: File[]) {
    const accepted: StagedAttachment[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const uploadType = resolveUploadType(file);
      if (!uploadType) {
        rejected.push(file.name);
        continue;
      }
      accepted.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        uploadType,
        previewUrl: uploadType.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      });
    }

    if (accepted.length > 0) {
      setStaged((current) => [...current, ...accepted]);
    }

    if (rejected.length > 0) {
      setComposeError(
        `Not attached: ${rejected.join(", ")}. Supported files are images, audio, PDF and text/log files.`,
      );
    } else {
      setComposeError(null);
    }
  }

  function removeStaged(id: string) {
    setStaged((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadFile(
    file: File,
    uploadType: string,
    fileName: string,
  ): Promise<CommentAttachment> {
    const safeFileName =
      fileName.length > 255 ? fileName.slice(0, 255) : fileName;
    const payload =
      file.type === uploadType
        ? file
        : new File([file], safeFileName, { type: uploadType });

    const form = new FormData();
    form.append("category", categoryForType(uploadType));
    form.append("file", payload, safeFileName);

    const response = await fetch(`/api/uploads?issueId=${issueId}`, {
      method: "POST",
      body: form,
    });
    const result = (await response.json().catch(() => null)) as
      | {
          success?: boolean;
          url?: string;
          file_size_bytes?: number;
          detail?: string;
          error?: { message?: string };
        }
      | null;

    if (!response.ok || !result?.url) {
      throw new Error(
        result?.detail ??
          result?.error?.message ??
          `Unable to upload ${fileName}.`,
      );
    }

    return {
      id: result.url,
      url: result.url,
      asset_type: uploadType,
      file_name: safeFileName,
      size_bytes: result.file_size_bytes ?? file.size,
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = body.trim();
    if (!trimmed && staged.length === 0 && !voice) {
      setComposeError("Write a comment or attach a file first.");
      return;
    }

    setSending(true);
    setComposeError(null);

    try {
      const attachments: CommentAttachment[] = [];

      for (const [index, item] of staged.entries()) {
        setUploadPhase(
          `Uploading attachment ${index + 1} of ${staged.length} (${item.file.name})…`,
        );
        attachments.push(
          await uploadFile(item.file, item.uploadType, item.file.name),
        );
      }

      if (voice) {
        setUploadPhase("Uploading voice note…");
        const mime = voice.mime.split(";")[0] || "audio/webm";
        const fileName = `voice-note${audioExtension(mime)}`;
        const audioFile = new File([voice.blob], fileName, { type: mime });
        attachments.push(await uploadFile(audioFile, mime, fileName));
      }

      setUploadPhase("Posting comment…");

      const response = await fetch(`/api/issues/${issueId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: trimmed,
          attachments: attachments.map((attachment) => ({
            url: attachment.url,
            asset_type: attachment.asset_type,
            file_name: attachment.file_name,
            size_bytes: attachment.size_bytes,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { comment?: IssueComment; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.comment) {
        setComposeError(
          payload?.error?.message ?? "Unable to post the comment.",
        );
        return;
      }

      setComments((current) => [...current, payload.comment!]);
      setBody("");
      for (const item of staged) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      setStaged([]);
      setVoice(null);
      setShowRecorder(false);
      setHighlightId(payload.comment.id);
      window.setTimeout(() => setHighlightId(null), 3000);
      onCommentPosted?.(payload.comment);
      window.dispatchEvent(new CustomEvent("argus:notifications-changed"));
    } catch (caught) {
      setComposeError(
        caught instanceof Error
          ? caught.message
          : "Unable to reach the server.",
      );
    } finally {
      setSending(false);
      setUploadPhase(null);
    }
  }

  const imagePreviewFor = useMemo(
    () => (comment: IssueComment) => {
      const images = comment.attachments
        .filter((attachment) => attachment.asset_type.startsWith("image/"))
        .map((attachment) => ({
          src: attachment.url,
          alt: attachment.file_name ?? "Comment image",
          title: attachment.file_name ?? "Comment image",
        }));
      return images;
    },
    [],
  );

  return (
    <aside className="flex flex-col border-t border-line bg-paper/50 lg:h-full lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            Conversation
          </h3>
          <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[10px] text-muted">
            {comments.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted">
          Back-and-forth between QA and the developer. Attach screenshots,
          voice notes or files. Newest comments appear at the bottom.
        </p>
      </div>

      <div
        ref={listRef}
        className="space-y-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
      >
        {loading ? (
          <p className="text-sm text-muted">Loading conversation…</p>
        ) : null}

        {loadError ? (
          <div className="rounded-md border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 rounded border border-bad/40 px-2 py-1 text-xs font-semibold text-bad"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !loadError && comments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
            No comments yet. Start the conversation below.
          </p>
        ) : null}

        {comments.length > 0 ? (
          <ol className="space-y-3">
            {comments.map((comment) => {
              const images = imagePreviewFor(comment);
              return (
                <li
                  key={comment.id}
                  id={commentElementId(issueId, comment.id)}
                  className={`rounded-xl border p-3 transition ${
                    highlightId === comment.id
                      ? "border-accent bg-accent-tint/50"
                      : "border-line bg-cream/70"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROLE_BADGE[comment.author_role]}`}
                    >
                      {ROLE_LABEL[comment.author_role]}
                    </span>
                    <time className="text-[11px] text-muted">
                      {new Date(comment.created_at).toLocaleString()}
                    </time>
                  </div>

                  {comment.body ? (
                    <div className="mt-2 text-sm text-ink-soft [&_a]:text-teal [&_a]:underline [&_code]:rounded [&_code]:bg-paper-2 [&_code]:px-1 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-paper-2 [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:list-disc">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {comment.body}
                      </ReactMarkdown>
                    </div>
                  ) : null}

                  {images.length > 0 ? (
                    <ul className="mt-2 grid grid-cols-2 gap-2">
                      {images.map((image, index) => (
                        <li key={`${comment.id}-image-${index}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setPreview({ images, index })
                            }
                            className="block w-full overflow-hidden rounded-lg border border-line-strong bg-paper transition hover:border-accent"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image.src}
                              alt={image.alt}
                              loading="lazy"
                              className="h-24 w-full object-cover"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {comment.attachments.some((attachment) =>
                    attachment.asset_type.startsWith("audio/"),
                  ) ? (
                    <ul className="mt-2 space-y-2">
                      {comment.attachments
                        .filter((attachment) =>
                          attachment.asset_type.startsWith("audio/"),
                        )
                        .map((attachment) => (
                          <li key={attachment.id}>
                            <audio
                              controls
                              src={attachment.url}
                              className="w-full"
                            >
                              <track kind="captions" />
                            </audio>
                          </li>
                        ))}
                    </ul>
                  ) : null}

                  {comment.attachments.some(
                    (attachment) =>
                      !attachment.asset_type.startsWith("image/") &&
                      !attachment.asset_type.startsWith("audio/"),
                  ) ? (
                    <ul className="mt-2 space-y-1">
                      {comment.attachments
                        .filter(
                          (attachment) =>
                            !attachment.asset_type.startsWith("image/") &&
                            !attachment.asset_type.startsWith("audio/"),
                        )
                        .map((attachment) => (
                          <li key={attachment.id}>
                            <a
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-2 rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-teal transition hover:border-teal"
                            >
                              <span aria-hidden="true">📄</span>
                              <span className="min-w-0 flex-1 truncate">
                                {attachment.file_name ??
                                  attachment.url.split("/").pop()}
                              </span>
                              {attachment.size_bytes !== null ? (
                                <span className="shrink-0 text-[10px] text-muted">
                                  {formatBytes(attachment.size_bytes)}
                                </span>
                              ) : null}
                            </a>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="shrink-0 space-y-2 border-t border-line bg-paper p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
            {viewer ? `Comment as ${ROLE_LABEL[viewer.role]}` : "New comment"}
          </span>
          {voice ? (
            <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-semibold text-accent-strong">
              Voice note ready
            </span>
          ) : null}
        </div>

        <textarea
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a comment (Markdown supported)…"
          disabled={sending}
          className="w-full rounded-md border border-line-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-teal disabled:opacity-70"
        />

        {staged.length > 0 || voice ? (
          <ul className="flex flex-wrap gap-2">
            {staged.map((item) => (
              <li
                key={item.id}
                className="flex max-w-full items-center gap-2 rounded-md border border-line bg-cream px-2 py-1 text-[11px] text-ink-soft"
              >
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="h-8 w-8 rounded border border-line object-cover"
                  />
                ) : (
                  <span aria-hidden="true">
                    {AUDIO_TYPES.has(item.uploadType) ? "🎙" : "📄"}
                  </span>
                )}
                <span className="min-w-0 max-w-[12rem] truncate">
                  {item.file.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted">
                  {formatBytes(item.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeStaged(item.id)}
                  aria-label={`Remove ${item.file.name}`}
                  disabled={sending}
                  className="rounded px-1 text-bad transition hover:bg-bad/10 disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
            {voice ? (
              <li className="flex items-center gap-2 rounded-md border border-accent/50 bg-accent-tint px-2 py-1 text-[11px] text-accent-strong">
                <span aria-hidden="true">🎙</span>
                <span>Voice note</span>
                <button
                  type="button"
                  onClick={() => {
                    setVoice(null);
                    setShowRecorder(false);
                  }}
                  disabled={sending}
                  aria-label="Remove voice note"
                  className="rounded px-1 text-bad transition hover:bg-bad/10 disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        {showRecorder ? (
          <VoiceRecorder
            hint="No duration limit. The voice note uploads with this comment."
            onRecorded={(blob, mimeType) => {
              setVoice(
                blob ? { blob, mime: mimeType ?? "audio/webm" } : null,
              );
              if (!blob) {
                setShowRecorder(false);
              }
            }}
          />
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />

        {uploadPhase ? (
          <p className="text-[11px] text-teal">{uploadPhase}</p>
        ) : null}

        {composeError ? (
          <p className="text-[11px] leading-4 text-bad">{composeError}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-ink-soft transition hover:bg-paper-2 disabled:opacity-50"
            >
              📎 Attach files
            </button>
            <button
              type="button"
              onClick={() => setShowRecorder((current) => !current)}
              disabled={sending}
              className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-ink-soft transition hover:bg-paper-2 disabled:opacity-50"
            >
              🎙 Voice note
            </button>
          </div>
          <button
            type="submit"
            disabled={sending || loading}
            className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-cream transition hover:bg-teal-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send comment"}
          </button>
        </div>
      </form>

      {preview ? (
        <ImageLightbox
          images={preview.images}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </aside>
  );
}
