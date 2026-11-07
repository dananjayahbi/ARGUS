"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  CanvasDraftData,
  CanvasNode,
  CanvasScene,
  CanvasTool,
} from "@/lib/canvas-types";
import { priorityTier } from "@/lib/priority";

import { DiagnosticsDrawer } from "./DiagnosticsDrawer";
import { VoiceRecorder } from "./VoiceRecorder";

interface CanvasSidePanelProps {
  issue: CanvasDraftData;
  token: string;
  scene: CanvasScene;
  selectedNode: CanvasNode | null;
  activeTool: CanvasTool;
  title: string;
  description: string;
  priority: number;
  titleError: string | null;
  environmentInfo: unknown;
  consoleLogs: unknown;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriorityChange: (value: number) => void;
  onSubmit: () => void;
  onAudioRecorded: (blob: Blob | null, mimeType: string | null) => void;
  isSubmitting: boolean;
  submitError: string | null;
  uploadSteps: Array<{
    label: string;
    status: "pending" | "active" | "done" | "error";
  }>;
  penColor: string;
  penWidth: number;
  blurMethod: "pixelate" | "blur";
  blurStrength: number;
  onPenColorChange: (color: string) => void;
  onPenWidthChange: (width: number) => void;
  onBlurMethodChange: (method: "pixelate" | "blur") => void;
  onBlurStrengthChange: (strength: number) => void;
  onUpdateNode: (
    id: string,
    updater: (node: CanvasNode) => CanvasNode,
  ) => void;
  onRenumberBadge: (id: string, number: number) => void;
  onDeleteNode: (id: string) => void;
  canUndoRedaction: boolean;
  onUndoRedaction: () => void;
  supplementaryAssets: Array<{ id: string; previewUrl: string }>;
  onRemoveSupplementaryAsset: (id: string) => void;
  hasPastedBackground: boolean;
}

const inputClass =
  "w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal";

export function CanvasSidePanel({
  issue,
  scene,
  selectedNode,
  activeTool,
  title,
  description,
  priority,
  titleError,
  environmentInfo,
  consoleLogs,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
  onSubmit,
  onAudioRecorded,
  isSubmitting,
  submitError,
  uploadSteps,
  penColor,
  penWidth,
  blurMethod,
  blurStrength,
  onPenColorChange,
  onPenWidthChange,
  onBlurMethodChange,
  onBlurStrengthChange,
  onUpdateNode,
  onRenumberBadge,
  onDeleteNode,
  canUndoRedaction,
  onUndoRedaction,
  supplementaryAssets,
  onRemoveSupplementaryAsset,
  hasPastedBackground,
}: CanvasSidePanelProps) {
  const [descriptionTab, setDescriptionTab] = useState<"write" | "preview">(
    "write",
  );
  const tier = priorityTier(priority);

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
          Bug configuration
        </p>
        <p className="mt-1 text-xs text-muted">
          Draft #{issue.issue_number} · {issue.report_type} ·{" "}
          {scene.nodes.length} annotation{scene.nodes.length === 1 ? "" : "s"}
        </p>
      </div>

      <section className="space-y-3">
        <label className="block space-y-1 text-xs text-muted">
          <span>Title</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Summarize the bug"
            className={inputClass}
          />
        </label>
        {titleError ? (
          <p className="text-xs text-bad">{titleError}</p>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              Description (Markdown)
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setDescriptionTab("write")}
                className={`rounded px-2 py-1 text-xs transition ${
                  descriptionTab === "write"
                    ? "bg-paper-2 text-ink"
                    : "text-muted hover:text-ink-soft"
                }`}
              >
                Write
              </button>
              <button
                type="button"
                onClick={() => setDescriptionTab("preview")}
                className={`rounded px-2 py-1 text-xs transition ${
                  descriptionTab === "preview"
                    ? "bg-paper-2 text-ink"
                    : "text-muted hover:text-ink-soft"
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          {descriptionTab === "write" ? (
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              rows={6}
              placeholder="Steps to reproduce, expected vs actual, environment notes…"
              className={inputClass}
            />
          ) : (
            <div className="min-h-32 rounded-md border border-line-strong bg-paper p-3 text-sm text-ink-soft [&_a]:text-teal [&_a]:underline [&_code]:rounded [&_code]:bg-paper-2 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-cream [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:list-disc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {description.trim() || "_No description yet._"}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <label className="block space-y-2 text-xs text-muted">
          <span className="flex items-center justify-between">
            <span>Priority</span>
            <span className="text-ink-soft">{priority}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={priority}
            onChange={(event) =>
              onPriorityChange(Number(event.target.value))
            }
            className="w-full accent-teal"
          />
          <span className={`block text-xs ${tier.tone}`}>
            {tier.label}{" "}
            <span className="text-muted">({tier.range})</span>
          </span>
        </label>

        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="w-full rounded-md bg-teal px-4 py-2 text-sm font-semibold text-cream transition hover:bg-teal-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Submitting…" : "Submit bug report"}
        </button>

        {uploadSteps.length > 0 ? (
          <ul className="space-y-1 rounded-md border border-line bg-cream/60 p-3 text-xs">
            {uploadSteps.map((step, index) => (
              <li
                key={`${step.label}-${index}`}
                className="flex items-center gap-2"
              >
                <span
                  className={
                    step.status === "done"
                      ? "text-good"
                      : step.status === "active"
                        ? "text-teal"
                        : step.status === "error"
                          ? "text-bad"
                          : "text-muted"
                  }
                >
                  {step.status === "done"
                    ? "✓"
                    : step.status === "active"
                      ? "●"
                      : step.status === "error"
                        ? "✕"
                        : "○"}
                </span>
                <span
                  className={
                    step.status === "error"
                      ? "text-bad"
                      : "text-muted"
                  }
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {submitError ? (
          <p className="rounded-md border border-bad/30 bg-bad/10 p-2 text-xs leading-5 text-bad">
            {submitError}
          </p>
        ) : null}
      </section>

      <VoiceRecorder onRecorded={onAudioRecorded} />

      <section className="space-y-3 rounded-lg border border-line bg-paper/40 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            Tool options
          </h3>
          <span className="text-xs text-teal">{activeTool}</span>
        </div>

        <label className="block space-y-1 text-xs text-muted">
          <span>Pen / arrow / rectangle colour</span>
          <input
            type="color"
            value={penColor}
            onChange={(event) => onPenColorChange(event.target.value)}
            className="h-9 w-full cursor-pointer rounded-md border border-line-strong bg-paper p-1"
          />
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Stroke width: {penWidth}px</span>
          <input
            type="range"
            min={1}
            max={20}
            value={penWidth}
            onChange={(event) => onPenWidthChange(Number(event.target.value))}
            className="w-full accent-teal"
          />
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Redaction method</span>
          <select
            value={blurMethod}
            onChange={(event) =>
              onBlurMethodChange(event.target.value as "pixelate" | "blur")
            }
            className={inputClass}
          >
            <option value="pixelate">Pixelate</option>
            <option value="blur">Gaussian blur</option>
          </select>
        </label>

        <label className="block space-y-1 text-xs text-muted">
          <span>Redaction strength: {blurStrength}px</span>
          <input
            type="range"
            min={2}
            max={40}
            value={blurStrength}
            onChange={(event) =>
              onBlurStrengthChange(Number(event.target.value))
            }
            className="w-full accent-teal"
          />
        </label>

        {canUndoRedaction ? (
          <button
            type="button"
            onClick={onUndoRedaction}
            className="w-full rounded-md border border-accent/50 px-3 py-2 text-xs font-medium text-accent-strong transition hover:bg-accent/10"
          >
            Undo last redaction
          </button>
        ) : null}

        <p className="text-xs leading-5 text-muted">
          New pen, arrow and rectangle annotations use these values. Redaction
          is burned into the exported PNG, not applied as a reversible overlay.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-line bg-paper/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
          Supplementary images
        </h3>

        {hasPastedBackground ? (
          <p className="text-xs text-teal">
            A pasted background is queued for upload at submit.
          </p>
        ) : null}

        {supplementaryAssets.length === 0 ? (
          <p className="text-xs leading-5 text-muted">
            Paste an image with Ctrl+V / Cmd+V to add a reference asset.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {supplementaryAssets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-md border border-line-strong"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.previewUrl}
                  alt="Supplementary asset"
                  className="h-20 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemoveSupplementaryAsset(asset.id)}
                  aria-label="Remove supplementary image"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/40 text-xs text-bad transition hover:bg-bad/20"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedNode ? (
        <section className="space-y-3 rounded-lg border border-teal/30 bg-teal/5 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-teal">
              Selected {selectedNode.type}
            </h3>
            <button
              type="button"
              onClick={() => onDeleteNode(selectedNode.id)}
              className="rounded-md border border-bad/40 px-2 py-1 text-xs font-medium text-bad transition hover:bg-bad/10"
            >
              Delete
            </button>
          </div>

          {selectedNode.type === "text" ? (
            <>
              <label className="block space-y-1 text-xs text-muted">
                <span>Text</span>
                <textarea
                  value={selectedNode.text}
                  onChange={(event) =>
                    onUpdateNode(selectedNode.id, (node) =>
                      node.type === "text"
                        ? { ...node, text: event.target.value }
                        : node,
                    )
                  }
                  rows={3}
                  className={inputClass}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs text-muted">
                  <span>Font size</span>
                  <input
                    type="number"
                    min={8}
                    max={96}
                    value={selectedNode.fontSize}
                    onChange={(event) =>
                      onUpdateNode(selectedNode.id, (node) =>
                        node.type === "text"
                          ? {
                              ...node,
                              fontSize: Math.max(
                                8,
                                Number(event.target.value) || 8,
                              ),
                            }
                          : node,
                      )
                    }
                    className={inputClass}
                  />
                </label>

                <label className="block space-y-1 text-xs text-muted">
                  <span>Background</span>
                  <input
                    type="color"
                    value={selectedNode.background ?? "#fdfbf6"}
                    onChange={(event) =>
                      onUpdateNode(selectedNode.id, (node) =>
                        node.type === "text"
                          ? { ...node, background: event.target.value }
                          : node,
                      )
                    }
                    className="h-9 w-full cursor-pointer rounded-md border border-line-strong bg-paper p-1"
                  />
                </label>
              </div>

              <label className="block space-y-1 text-xs text-muted">
                <span>Text colour</span>
                <input
                  type="color"
                  value={selectedNode.fill}
                  onChange={(event) =>
                    onUpdateNode(selectedNode.id, (node) =>
                      node.type === "text"
                        ? { ...node, fill: event.target.value }
                        : node,
                    )
                  }
                  className="h-9 w-full cursor-pointer rounded-md border border-line-strong bg-paper p-1"
                />
              </label>
            </>
          ) : null}

          {selectedNode.type === "badge" ? (
            <label className="block space-y-1 text-xs text-muted">
              <span>Badge number</span>
              <input
                type="number"
                min={1}
                value={selectedNode.number}
                onChange={(event) =>
                  onRenumberBadge(
                    selectedNode.id,
                    Number(event.target.value) || 1,
                  )
                }
                className={inputClass}
              />
            </label>
          ) : null}

          {selectedNode.type === "blur" ? (
            <>
              <label className="block space-y-1 text-xs text-muted">
                <span>Redaction method</span>
                <select
                  value={selectedNode.method}
                  onChange={(event) =>
                    onUpdateNode(selectedNode.id, (node) =>
                      node.type === "blur"
                        ? {
                            ...node,
                            method: event.target.value as "pixelate" | "blur",
                          }
                        : node,
                    )
                  }
                  className={inputClass}
                >
                  <option value="pixelate">Pixelate</option>
                  <option value="blur">Gaussian blur</option>
                </select>
              </label>

              <label className="block space-y-1 text-xs text-muted">
                <span>Strength: {selectedNode.strength}px</span>
                <input
                  type="range"
                  min={2}
                  max={40}
                  value={selectedNode.strength}
                  onChange={(event) =>
                    onUpdateNode(selectedNode.id, (node) =>
                      node.type === "blur"
                        ? {
                            ...node,
                            strength: Math.max(
                              2,
                              Number(event.target.value) || 2,
                            ),
                          }
                        : node,
                    )
                  }
                  className="w-full accent-teal"
                />
              </label>
            </>
          ) : null}

          {selectedNode.type === "pen" ||
          selectedNode.type === "arrow" ||
          selectedNode.type === "rect" ? (
            <>
              <label className="block space-y-1 text-xs text-muted">
                <span>Stroke colour</span>
                <input
                  type="color"
                  value={selectedNode.stroke}
                  onChange={(event) =>
                    onUpdateNode(selectedNode.id, (node) =>
                      node.type === "pen" ||
                      node.type === "arrow" ||
                      node.type === "rect"
                        ? { ...node, stroke: event.target.value }
                        : node,
                    )
                  }
                  className="h-9 w-full cursor-pointer rounded-md border border-line-strong bg-paper p-1"
                />
              </label>

              <label className="block space-y-1 text-xs text-muted">
                <span>Stroke width: {selectedNode.strokeWidth}px</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={selectedNode.strokeWidth}
                  onChange={(event) =>
                    onUpdateNode(selectedNode.id, (node) =>
                      node.type === "pen" ||
                      node.type === "arrow" ||
                      node.type === "rect"
                        ? {
                            ...node,
                            strokeWidth: Math.max(
                              1,
                              Number(event.target.value) || 1,
                            ),
                          }
                        : node,
                    )
                  }
                  className="w-full accent-teal"
                />
              </label>
            </>
          ) : null}
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm leading-6 text-muted">
          Select an annotation to edit it. Drag to move, use the handles to
          resize rectangles, or press Delete to remove it.
        </p>
      )}

      <DiagnosticsDrawer
        environmentInfo={environmentInfo}
        consoleLogs={consoleLogs}
      />

      <div className="rounded-lg border border-dashed border-line p-4 text-sm leading-6 text-muted">
        Voice notes and the submission pipeline arrive in the next canvas
        tasks.
      </div>
    </div>
  );
}
