"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createEmptyScene,
  parseCanvasScene,
  serializeCanvasScene,
  type BlurNode,
  type CanvasDraftData,
  type CanvasNode,
  type CanvasScene,
  type CanvasTool,
} from "@/lib/canvas-types";
import {
  removeSceneNode,
  renumberBadge,
  updateSceneNode,
} from "@/lib/canvas-scene";
import { audioExtension } from "@/lib/audio";
import { collectCaptureImages } from "@/lib/captured-pages";

import { CanvasSidePanel } from "./CanvasSidePanel";
import { CanvasToolIcon } from "./CanvasToolIcon";
import { CaptureImagePanel } from "./CaptureImagePanel";
import { useCanvasViewport } from "./useCanvasViewport";

const CanvasStage = dynamic(
  () => import("./CanvasStage").then((module) => module.CanvasStage),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center text-sm text-muted">
        Loading canvas…
      </div>
    ),
  },
);

const TOOLS: Array<{ id: CanvasTool; label: string }> = [
  { id: "select", label: "Select (V)" },
  { id: "pen", label: "Pen (P)" },
  { id: "text", label: "Text (T)" },
  { id: "rect", label: "Rectangle (R)" },
  { id: "arrow", label: "Arrow (A)" },
  { id: "badge", label: "Numbered badge (1)" },
  { id: "blur", label: "Blur or pixelate (B)" },
];

function initialCanvasState(issue: CanvasDraftData) {
  const restored = parseCanvasScene(issue.canvas_state);
  const scene =
    restored ?? createEmptyScene(1, 1, issue.raw_image_url ?? undefined);
  return {
    scene,
    backgroundUrl: scene.background ?? issue.raw_image_url ?? null,
  };
}

/**
 * Close the canvas tab after submit/delete.
 *
 * `window.close()` only works for tabs that the page itself opened, so the
 * ARGUS extension content script also listens for this postMessage and closes
 * the tab through chrome.tabs.remove. Both paths are attempted; if a browser
 * blocks them the success screens still expose a Close tab button.
 */
function requestCanvasClose() {
  try {
    window.postMessage({ type: "ARGUS_CLOSE_CANVAS" }, window.location.origin);
  } catch {
    // Fall through to window.close().
  }
  window.close();
}

export function CanvasEditorShell({
  issue,
  token,
}: {
  issue: CanvasDraftData;
  token: string;
}) {
  const initialCanvas = useMemo(() => initialCanvasState(issue), [issue]);

  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [scene, setScene] = useState<CanvasScene>(initialCanvas.scene);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [penColor, setPenColor] = useState("#d08a43");
  const [penWidth, setPenWidth] = useState(3);
  const [blurMethod, setBlurMethod] = useState<"pixelate" | "blur">("pixelate");
  const [blurStrength, setBlurStrength] = useState(12);
  const [pendingRedaction, setPendingRedaction] = useState<BlurNode | null>(
    null,
  );
  const [lastRedactionId, setLastRedactionId] = useState<string | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(
    initialCanvas.backgroundUrl,
  );
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const sceneCache = useRef<Record<string, CanvasScene>>({});
  const backgroundFiles = useRef<Record<string, File>>({});
  const [supplementaryAssets, setSupplementaryAssets] = useState<
    Array<{ id: string; file: File; previewUrl: string }>
  >([]);
  const [pasteCandidate, setPasteCandidate] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const objectUrls = useRef<Set<string>>(new Set());
  const audioRef = useRef<{ blob: Blob; mimeType: string } | null>(null);
  const flattenRef = useRef<(() => string | null) | null>(null);
  const inFlightRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadSteps, setUploadSteps] = useState<
    Array<{
      label: string;
      status: "pending" | "active" | "done" | "error";
    }>
  >([]);
  const [submissionResult, setSubmissionResult] = useState<{
    redirectUrl: string;
  } | null>(null);
  const [confirmDeleteDraft, setConfirmDeleteDraft] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [deleteDraftError, setDeleteDraftError] = useState<string | null>(null);
  const [draftDeleted, setDraftDeleted] = useState(false);
  const [title, setTitle] = useState(
    issue.title && issue.title !== "Untitled draft" ? issue.title : "",
  );
  const [description, setDescription] = useState(issue.description ?? "");
  const [priority, setPriority] = useState(issue.priority ?? 50);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const viewport = useCanvasViewport();
  const selectedNode =
    scene.nodes.find((node) => node.id === selectedId) ?? null;
  const effectiveTool: CanvasTool | "pan" = viewport.spacePressed
    ? "pan"
    : activeTool;

  const captureImages = useMemo(
    () =>
      collectCaptureImages({
        environmentInfo: issue.environment_info,
        primaryUrl: issue.raw_image_url,
        supplementaryAssets: issue.supplementary_assets.filter((asset) =>
          asset.asset_type.startsWith("image/"),
        ),
        extraUrls: backgroundUrl ? [backgroundUrl] : [],
      }),
    [
      backgroundUrl,
      issue.environment_info,
      issue.raw_image_url,
      issue.supplementary_assets,
    ],
  );

  const handleSelectCapture = useCallback(
    (url: string) => {
      if (url === backgroundUrl) {
        return;
      }

      if (backgroundUrl) {
        sceneCache.current[backgroundUrl] = scene;
      }
      const cached = sceneCache.current[url];
      setBackgroundUrl(url);
      setBackgroundFile(backgroundFiles.current[url] ?? null);
      setSelectedId(null);
      setPendingRedaction(null);
      setLastRedactionId(null);
      setScene(cached ?? createEmptyScene(1, 1, url));
    },
    [backgroundUrl, scene],
  );

  const handleAddNode = useCallback((node: CanvasNode) => {
    setScene((current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));
    setSelectedId(node.id);
  }, []);

  const handleUpdateNode = useCallback(
    (id: string, updater: (node: CanvasNode) => CanvasNode) => {
      setScene((current) => updateSceneNode(current, id, updater));
    },
    [],
  );

  const handleDeleteNode = useCallback((id: string) => {
    setScene((current) => removeSceneNode(current, id));
    setSelectedId((current) => (current === id ? null : current));
    setLastRedactionId((current) => (current === id ? null : current));
  }, []);

  const handleRequestRedaction = useCallback((node: BlurNode) => {
    setPendingRedaction(node);
  }, []);

  const handleApplyRedaction = useCallback(() => {
    if (!pendingRedaction) {
      return;
    }

    setScene((current) => ({
      ...current,
      nodes: [...current.nodes, pendingRedaction],
    }));
    setSelectedId(pendingRedaction.id);
    setLastRedactionId(pendingRedaction.id);
    setPendingRedaction(null);
  }, [pendingRedaction]);

  const handleCancelRedaction = useCallback(() => {
    setPendingRedaction(null);
  }, []);

  const handleUndoRedaction = useCallback(() => {
    if (lastRedactionId) {
      handleDeleteNode(lastRedactionId);
    }
  }, [handleDeleteNode, lastRedactionId]);

  const handleRenumberBadge = useCallback((id: string, number: number) => {
    setScene((current) => renumberBadge(current, id, number));
  }, []);

  const handleImageSize = useCallback((width: number, height: number) => {
    setScene((current) =>
      current.width === width && current.height === height
        ? current
        : { ...current, width, height },
    );
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!selectedId) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      handleDeleteNode(selectedId);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleDeleteNode, selectedId]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItem = Array.from(items).find((item) =>
        item.type.startsWith("image/"),
      );
      if (!imageItem) {
        return;
      }

      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      setPasteCandidate({ file, previewUrl });
      setConfirmReplace(false);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleCancelPaste = useCallback(() => {
    if (pasteCandidate) {
      URL.revokeObjectURL(pasteCandidate.previewUrl);
      objectUrls.current.delete(pasteCandidate.previewUrl);
    }
    setPasteCandidate(null);
    setConfirmReplace(false);
  }, [pasteCandidate]);

  const handlePasteAppend = useCallback(() => {
    if (!pasteCandidate) {
      return;
    }

    setSupplementaryAssets((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        file: pasteCandidate.file,
        previewUrl: pasteCandidate.previewUrl,
      },
    ]);
    setPasteCandidate(null);
    setConfirmReplace(false);
  }, [pasteCandidate]);

  const handlePasteReplace = useCallback(() => {
    if (!pasteCandidate) {
      return;
    }

    if (scene.nodes.length > 0 && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }

    if (backgroundUrl) {
      sceneCache.current[backgroundUrl] = scene;
    }
    backgroundFiles.current[pasteCandidate.previewUrl] = pasteCandidate.file;

    setBackgroundUrl(pasteCandidate.previewUrl);
    setBackgroundFile(pasteCandidate.file);
    setScene(createEmptyScene(1, 1, pasteCandidate.previewUrl));
    setSelectedId(null);
    setPendingRedaction(null);
    setLastRedactionId(null);
    setPasteCandidate(null);
    setConfirmReplace(false);
  }, [backgroundUrl, confirmReplace, pasteCandidate, scene]);

  const handleRemoveSupplementaryAsset = useCallback((id: string) => {
    setSupplementaryAssets((current) => {
      const asset = current.find((item) => item.id === id);
      if (asset) {
        URL.revokeObjectURL(asset.previewUrl);
        objectUrls.current.delete(asset.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`argus:canvas:${issue.id}`);
      if (raw) {
        const saved = JSON.parse(raw) as {
          title?: unknown;
          description?: unknown;
          priority?: unknown;
        };
        if (typeof saved.title === "string") {
          setTitle(saved.title);
        }
        if (typeof saved.description === "string") {
          setDescription(saved.description);
        }
        if (
          typeof saved.priority === "number" &&
          saved.priority >= 0 &&
          saved.priority <= 100
        ) {
          setPriority(Math.round(saved.priority));
        }
      }
    } catch {
      // Ignore malformed storage and keep the issue defaults.
    }
    setHydrated(true);
  }, [issue.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    try {
      window.localStorage.setItem(
        `argus:canvas:${issue.id}`,
        JSON.stringify({ title, description, priority }),
      );
    } catch {
      // Storage can be unavailable in private or restricted contexts.
    }
  }, [description, hydrated, issue.id, priority, title]);

  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    setTitleError((current) => (current ? null : current));
  }, []);

  const handleAudioRecorded = useCallback(
    (blob: Blob | null, mimeType: string | null) => {
      audioRef.current = blob && mimeType ? { blob, mimeType } : null;
    },
    [],
  );

  const handleRegisterFlatten = useCallback(
    (fn: (() => string | null) | null) => {
      flattenRef.current = fn;
    },
    [],
  );

  const uploadFile = useCallback(
    async (category: string, blob: Blob, filename: string) => {
      const form = new FormData();
      form.append("category", category);
      form.append("file", blob, filename);

      const response = await fetch(
        `/api/uploads?issueId=${issue.id}&token=${encodeURIComponent(token)}`,
        { method: "POST", body: form },
      );
      const body = (await response.json()) as {
        url?: string;
        detail?: string;
        error?: { message?: string };
      };

      if (!response.ok || !body.url) {
        throw new Error(
          body.detail ??
            body.error?.message ??
            `Upload failed for ${category}.`,
        );
      }

      return body.url;
    },
    [issue.id, token],
  );

  const handleSubmit = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    if (!title.trim()) {
      setTitleError("A title is required before submitting.");
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    setTitleError(null);
    setSubmitError(null);
    setSubmissionResult(null);

    const steps: Array<{
      label: string;
      status: "pending" | "active" | "done" | "error";
    }> = [];
    const addStep = (label: string) => {
      steps.push({ label, status: "pending" });
      return steps.length - 1;
    };

    const flattenStep = addStep("Flatten annotated PNG");
    const annotatedStep = addStep("Upload annotated PNG");
    const audioStep = audioRef.current ? addStep("Upload voice note") : null;
    const backgroundStep = backgroundFile
      ? addStep("Upload replacement background")
      : null;
    const supplementaryStep =
      supplementaryAssets.length > 0
        ? addStep(
            `Upload ${supplementaryAssets.length} supplementary image${
              supplementaryAssets.length === 1 ? "" : "s"
            }`,
          )
        : null;
    const finalizeStep = addStep("Finalize issue");

    setUploadSteps(steps.map((step) => ({ ...step })));

    const mark = (
      index: number,
      status: "active" | "done" | "error",
    ) => {
      setUploadSteps((current) =>
        current.map((step, stepIndex) =>
          stepIndex === index ? { ...step, status } : step,
        ),
      );
    };

    try {
      let annotatedUrl: string | null = null;

      if (issue.raw_image_url) {
        mark(flattenStep, "active");
        const dataUrl = flattenRef.current?.();
        if (!dataUrl) {
          throw new Error("The canvas is not ready to export.");
        }
        const annotatedBlob = await (await fetch(dataUrl)).blob();
        mark(flattenStep, "done");

        mark(annotatedStep, "active");
        annotatedUrl = await uploadFile(
          "annotated",
          annotatedBlob,
          `annotated-${issue.id}.png`,
        );
        mark(annotatedStep, "done");
      } else {
        mark(flattenStep, "done");
        mark(annotatedStep, "done");
      }

      let audioUrl: string | null = null;
      if (audioStep !== null && audioRef.current) {
        mark(audioStep, "active");
        audioUrl = await uploadFile(
          "audio",
          audioRef.current.blob,
          `voice-note${audioExtension(audioRef.current.mimeType)}`,
        );
        mark(audioStep, "done");
      }

      let rawUrl: string | null = null;
      if (backgroundStep !== null && backgroundFile) {
        mark(backgroundStep, "active");
        rawUrl = await uploadFile(
          "raw",
          backgroundFile,
          backgroundFile.name || "background.png",
        );
        mark(backgroundStep, "done");
      }

      const supplementary: Array<{ url: string; asset_type: string }> = [];
      if (supplementaryStep !== null) {
        mark(supplementaryStep, "active");
        for (const asset of supplementaryAssets) {
          const url = await uploadFile(
            "reconsider",
            asset.file,
            asset.file.name || "supplementary.png",
          );
          supplementary.push({
            url,
            asset_type: asset.file.type || "application/octet-stream",
          });
        }
        mark(supplementaryStep, "done");
      }

      mark(finalizeStep, "active");
      const response = await fetch(
        `/api/issues/${issue.id}/finalize?token=${encodeURIComponent(token)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description,
            priority,
            annotated_image_url: annotatedUrl,
            canvas_state: serializeCanvasScene(scene),
            audio_note_url: audioUrl,
            raw_image_url: rawUrl,
            supplementary_assets: supplementary,
          }),
        },
      );
      const body = (await response.json()) as {
        redirect_url?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Unable to finalize the issue.",
        );
      }

      mark(finalizeStep, "done");
      setSubmissionResult({
        redirectUrl: `${body.redirect_url ?? "/dashboard"}?issue=${issue.id}`,
      });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Submission failed. Your draft is still intact.";
      setSubmitError(`${message} Your draft is intact; retry when ready.`);
      setUploadSteps((current) =>
        current.map((step) =>
          step.status === "active" ? { ...step, status: "error" } : step,
        ),
      );
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    backgroundFile,
    description,
    issue.id,
    issue.raw_image_url,
    priority,
    scene,
    supplementaryAssets,
    title,
    token,
    uploadFile,
  ]);

  useEffect(() => {
    if (!submissionResult && !draftDeleted) {
      return;
    }
    // The canvas is opened in its own tab by the extension or dashboard. Close
    // it after the success screen paints; the screen also offers a manual
    // Close tab button for browsers that block window.close().
    const timer = window.setTimeout(() => {
      requestCanvasClose();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [draftDeleted, submissionResult]);

  const handleDeleteDraft = useCallback(async () => {
    if (deletingDraft) {
      return;
    }

    setDeletingDraft(true);
    setDeleteDraftError(null);

    try {
      const response = await fetch(
        `/api/issues/${issue.id}?token=${encodeURIComponent(token)}`,
        { method: "DELETE" },
      );
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        setDeleteDraftError(
          body?.error?.message ?? "Unable to delete the draft.",
        );
        return;
      }

      setConfirmDeleteDraft(false);
      setDraftDeleted(true);
    } catch {
      setDeleteDraftError("Unable to reach the server.");
    } finally {
      setDeletingDraft(false);
    }
  }, [deletingDraft, issue.id, token]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-cream text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-teal-hover bg-teal px-6 py-3 text-cream">
        <div className="flex items-center gap-3">
          <Image
            src="/argus-logo.png"
            alt=""
            width={28}
            height={28}
            priority
            className="rounded-full"
          />
          <span className="text-sm font-bold tracking-[0.16em] text-cream">
            ARGUS
          </span>
          <span className="text-sm text-teal-tint">
            {issue.project_name} · {issue.project_key}-{issue.issue_number}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-teal-tint">
            Tool: <span className="font-semibold text-cream">{effectiveTool}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteDraft(true);
              setDeleteDraftError(null);
            }}
            className="rounded-lg border border-accent/70 px-2 py-1 text-xs font-semibold text-accent transition hover:bg-accent/15"
          >
            Delete draft
          </button>
          <span className="rounded-full border border-accent bg-accent px-3 py-1 text-xs font-bold text-ink">
            Draft
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r border-line bg-cream lg:w-64">
          <CaptureImagePanel
            images={captureImages}
            activeUrl={backgroundUrl}
            onSelect={handleSelectCapture}
          />
        </aside>

        <section className="relative min-w-0 flex-1 bg-paper">
          <CanvasStage
            imageUrl={backgroundUrl}
            viewport={viewport}
            spacePressed={viewport.spacePressed}
            isPanning={viewport.isPanning}
            activeTool={activeTool}
            scene={scene}
            selectedId={selectedId}
            penColor={penColor}
            penWidth={penWidth}
            blurMethod={blurMethod}
            blurStrength={blurStrength}
            onSelect={setSelectedId}
            onAddNode={handleAddNode}
            onUpdateNode={handleUpdateNode}
            onRequestRedaction={handleRequestRedaction}
            onImageSize={handleImageSize}
            registerFlatten={handleRegisterFlatten}
          />

          <div className="absolute left-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-line-strong bg-cream/90 p-1 shadow-lg">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                title={tool.label}
                aria-label={tool.label}
                aria-pressed={activeTool === tool.id}
                onClick={() => {
                  setActiveTool(tool.id);
                  if (tool.id !== "select") {
                    setSelectedId(null);
                  }
                }}
                className={`grid h-8 w-8 place-items-center rounded-md transition ${
                  activeTool === tool.id
                    ? "bg-teal text-cream"
                    : "text-muted hover:bg-paper-2 hover:text-ink"
                }`}
              >
                <CanvasToolIcon tool={tool.id} />
              </button>
            ))}
          </div>

          <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-line-strong bg-cream/90 px-3 py-1.5 shadow-lg">
            <span className="text-xs tabular-nums text-muted">
              {Math.round(viewport.transform.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={viewport.resetToFit}
              className="rounded-md px-2 py-1 text-xs font-medium text-teal transition hover:bg-paper-2"
            >
              Reset view
            </button>
          </div>
        </section>

        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-line bg-cream">
          <CanvasSidePanel
            issue={issue}
            token={token}
            scene={scene}
            selectedNode={selectedNode}
            activeTool={activeTool}
            title={title}
            description={description}
            priority={priority}
            titleError={titleError}
            environmentInfo={issue.environment_info}
            consoleLogs={issue.console_logs}
            onTitleChange={handleTitleChange}
            onDescriptionChange={setDescription}
            onPriorityChange={setPriority}
            onSubmit={handleSubmit}
            onAudioRecorded={handleAudioRecorded}
            isSubmitting={isSubmitting}
            submitError={submitError}
            uploadSteps={uploadSteps}
            penColor={penColor}
            penWidth={penWidth}
            blurMethod={blurMethod}
            blurStrength={blurStrength}
            onPenColorChange={setPenColor}
            onPenWidthChange={setPenWidth}
            onBlurMethodChange={setBlurMethod}
            onBlurStrengthChange={setBlurStrength}
            onUpdateNode={handleUpdateNode}
            onRenumberBadge={handleRenumberBadge}
            onDeleteNode={handleDeleteNode}
            canUndoRedaction={Boolean(lastRedactionId)}
            onUndoRedaction={handleUndoRedaction}
            supplementaryAssets={supplementaryAssets.map(
              ({ id, previewUrl }) => ({ id, previewUrl }),
            )}
            onRemoveSupplementaryAsset={handleRemoveSupplementaryAsset}
            hasPastedBackground={Boolean(backgroundFile)}
          />
        </aside>
      </div>

      {pendingRedaction ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-line-strong bg-paper p-6 shadow-2xl">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-strong">
                PII redaction
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Apply this redaction?
              </h2>
            </div>

            <p className="text-sm leading-6 text-muted">
              The selected area is burned into the exported PNG. The original
              pixels inside it will not be recoverable from the flattened
              image.
            </p>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Method</dt>
                <dd className="text-ink-soft">
                  {pendingRedaction.method === "pixelate"
                    ? "Pixelate"
                    : "Gaussian blur"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Strength</dt>
                <dd className="text-ink-soft">
                  {pendingRedaction.strength}px
                </dd>
              </div>
              <div>
                <dt className="text-muted">Area</dt>
                <dd className="text-ink-soft">
                  {Math.round(pendingRedaction.width)} ×{" "}
                  {Math.round(pendingRedaction.height)}
                </dd>
              </div>
            </dl>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelRedaction}
                className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyRedaction}
                className="rounded-md bg-bad px-4 py-2 text-sm font-semibold text-cream transition hover:bg-bad-hover"
              >
                Apply redaction
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pasteCandidate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-line-strong bg-paper p-6 shadow-2xl">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-strong">
                Clipboard image
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Use this pasted image?
              </h2>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pasteCandidate.previewUrl}
              alt="Pasted clipboard preview"
              className="max-h-64 w-full rounded-lg border border-line object-contain"
            />

            {confirmReplace ? (
              <p className="rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
                Replacing the background will discard {scene.nodes.length}{" "}
                annotation{scene.nodes.length === 1 ? "" : "s"}. Continue?
              </p>
            ) : (
              <p className="text-sm leading-6 text-muted">
                Replace the screenshot you are annotating, or keep it and add
                this image as a supplementary reference for the issue.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelPaste}
                className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2"
              >
                Cancel
              </button>

              {confirmReplace ? (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmReplace(false)}
                    className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2"
                  >
                    Keep annotations
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteReplace}
                    className="rounded-md bg-bad px-4 py-2 text-sm font-semibold text-cream transition hover:bg-bad-hover"
                  >
                    Yes, replace
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePasteAppend}
                    className="rounded-md border border-teal/40 px-4 py-2 text-sm font-medium text-teal transition hover:bg-teal/10"
                  >
                    Add as supplementary
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteReplace}
                    className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-cream transition hover:bg-teal-hover"
                  >
                    Replace background
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-bad/30 bg-paper p-6 shadow-2xl">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-bad">
                Delete draft
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Delete {issue.project_key}-{issue.issue_number}?
              </h2>
            </div>
            <p className="text-sm leading-6 text-muted">
              The draft, its uploaded raw captures and any annotations will be
              removed. This cannot be undone.
            </p>
            {deleteDraftError ? (
              <p className="rounded-md border border-bad/30 bg-bad/10 p-2 text-xs text-bad">
                {deleteDraftError}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteDraft(false);
                  setDeleteDraftError(null);
                }}
                disabled={deletingDraft}
                className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteDraft();
                }}
                disabled={deletingDraft}
                className="rounded-md bg-bad px-4 py-2 text-sm font-semibold text-cream transition hover:bg-bad-hover disabled:opacity-60"
              >
                {deletingDraft ? "Deleting…" : "Delete draft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draftDeleted ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-line-strong bg-paper p-6 shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
              Draft deleted
            </p>
            <h2 className="text-lg font-semibold text-ink">
              {issue.project_key}-{issue.issue_number} was removed
            </h2>
            <p className="text-sm leading-6 text-muted">
              The draft and its uploads are gone. This tab should close
              automatically.
            </p>
            <button
              type="button"
              onClick={() => requestCanvasClose()}
              className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2"
            >
              Close tab
            </button>
          </div>
        </div>
      ) : null}

      {submissionResult ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-good/30 bg-paper p-6 shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-good">
              Submitted
            </p>
            <h2 className="text-lg font-semibold text-ink">
              Bug report is pending
            </h2>
            <p className="text-sm leading-6 text-muted">
              The annotated PNG, vector scene and any attachments have been
              saved. The issue is now in the Pending column.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={submissionResult.redirectUrl}
                className="inline-block rounded-md bg-good px-4 py-2 text-sm font-semibold text-cream transition hover:bg-good-hover"
              >
                Open on the Kanban board
              </a>
              <button
                type="button"
                onClick={() => requestCanvasClose()}
                className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-soft transition hover:bg-paper-2"
              >
                Close tab
              </button>
            </div>
            <p className="text-xs text-muted">
              This tab closes automatically. If the browser blocks it, use
              Close tab.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
