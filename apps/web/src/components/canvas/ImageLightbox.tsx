"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  computeFitTransform,
  panBy,
  zoomAtPoint,
  type ViewportTransform,
} from "./useCanvasViewport";

interface Point {
  x: number;
  y: number;
}

export interface LightboxImage {
  src: string;
  alt: string;
  title?: string;
}

function clampZoom(scale: number) {
  return clampScale(scale, MIN_SCALE, MAX_SCALE);
}

/**
 * Full-viewport image preview.
 *
 * - Mouse wheel zooms around the cursor.
 * - Hold Space and drag (or drag with the middle mouse button) to pan.
 * - Double-click zooms in; Shift+double-click zooms out.
 * - Escape closes the preview.
 * - Pass `images` to browse an ordered gallery with the arrow keys or the
 *   previous/next buttons without closing the preview.
 */
export function ImageLightbox({
  src,
  alt,
  title,
  images,
  initialIndex = 0,
  onClose,
}: {
  src?: string;
  alt?: string;
  title?: string;
  images?: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<{ width: number; height: number } | null>(null);
  const dragRef = useRef<{
    pointer: Point;
    transform: ViewportTransform;
  } | null>(null);

  const gallery: LightboxImage[] =
    images && images.length > 0
      ? images
      : src
        ? [{ src, alt: alt ?? "", title }]
        : [];
  const count = gallery.length;
  const canNavigate = count > 1;

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const safeIndex =
    count === 0 ? 0 : Math.min(Math.max(activeIndex, 0), count - 1);
  const active = gallery[safeIndex];

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [transform, setTransform] = useState<ViewportTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const imageVisible = Boolean(natural) && loadedSrc === active?.src;

  const step = useCallback(
    (delta: number) => {
      if (count < 2) {
        return;
      }
      dragRef.current = null;
      setDragging(false);
      setActiveIndex((current) => (((current + delta) % count) + count) % count);
    },
    [count],
  );

  const fitToViewport = useCallback(() => {
    if (!natural || size.width <= 0 || size.height <= 0) {
      return;
    }
    setTransform(
      computeFitTransform(
        natural.width,
        natural.height,
        size.width,
        size.height,
      ),
    );
  }, [natural, size.height, size.width]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize({ width, height });

      const current = naturalRef.current;
      if (current && width > 0 && height > 0) {
        setTransform(
          computeFitTransform(
            current.width,
            current.height,
            width,
            height,
          ),
        );
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.code === "Space" && !isEditable(event.target)) {
        event.preventDefault();
        setSpaceHeld(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceHeld(false);
        dragRef.current = null;
        setDragging(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onClose, step]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const factor = Math.exp(-event.deltaY * 0.0015);
      setTransform((current) =>
        zoomAtPoint(current, pointer, clampZoom(current.scale * factor)),
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state) {
        return;
      }
      const dx = event.clientX - state.pointer.x;
      const dy = event.clientY - state.pointer.y;
      setTransform(panBy(state.transform, dx, dy));
    };

    const onPointerUp = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragging]);

  const beginPan = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const canPan = spaceHeld || event.button === 1;
      if (!canPan) {
        return;
      }
      event.preventDefault();
      dragRef.current = {
        pointer: { x: event.clientX, y: event.clientY },
        transform,
      };
      setDragging(true);
    },
    [spaceHeld, transform],
  );

  const zoomByStep = useCallback(
    (factor: number) => {
      setTransform((current) =>
        zoomAtPoint(
          current,
          { x: size.width / 2, y: size.height / 2 },
          clampZoom(current.scale * factor),
        ),
      );
    },
    [size.height, size.width],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const factor = event.shiftKey ? 0.5 : 2;
      setTransform((current) =>
        zoomAtPoint(current, pointer, clampZoom(current.scale * factor)),
      );
    },
    [],
  );

  const cursor = spaceHeld
    ? dragging
      ? "grabbing"
      : "grab"
    : "default";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        active?.title
          ? `Preview: ${active.title}`
          : `Preview: ${active?.alt ?? "image"}`
      }
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950/98"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-6 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-400">
            Image preview
          </p>
          <p className="truncate text-sm text-slate-300">
            {active?.title ?? active?.alt ?? "Image"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canNavigate ? (
            <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className="h-8 w-8 rounded text-lg leading-none text-slate-300 transition hover:bg-slate-800"
              >
                ‹
              </button>
              <span className="w-14 text-center text-xs tabular-nums text-slate-400">
                {safeIndex + 1} / {count}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="h-8 w-8 rounded text-lg leading-none text-slate-300 transition hover:bg-slate-800"
              >
                ›
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => zoomByStep(1 / 1.25)}
              aria-label="Zoom out"
              className="h-8 w-8 rounded text-lg leading-none text-slate-300 transition hover:bg-slate-800"
            >
              −
            </button>
            <span className="w-14 text-center text-xs tabular-nums text-slate-400">
              {Math.round(transform.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomByStep(1.25)}
              aria-label="Zoom in"
              className="h-8 w-8 rounded text-lg leading-none text-slate-300 transition hover:bg-slate-800"
            >
              +
            </button>
            <button
              type="button"
              onClick={fitToViewport}
              className="rounded px-2 py-1 text-xs font-medium text-cyan-300 transition hover:bg-slate-800"
            >
              Fit
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </header>

      <div
        ref={containerRef}
        onPointerDown={beginPan}
        onDoubleClick={handleDoubleClick}
        className="relative min-h-0 flex-1 overflow-hidden select-none"
        style={{ cursor }}
      >
        {canNavigate ? (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous image"
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-2xl leading-none text-slate-200 transition hover:bg-slate-800"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next image"
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-2xl leading-none text-slate-200 transition hover:bg-slate-800"
            >
              ›
            </button>
          </>
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={active?.src}
          src={active?.src}
          alt={active?.alt ?? ""}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            const next = {
              width: image.naturalWidth,
              height: image.naturalHeight,
            };
            naturalRef.current = next;
            setNatural(next);
            setLoadedSrc(active?.src ?? null);

            const element = containerRef.current;
            if (element && next.width > 0 && next.height > 0) {
              setTransform(
                computeFitTransform(
                  next.width,
                  next.height,
                  element.clientWidth,
                  element.clientHeight,
                ),
              );
            }
          }}
          className="absolute left-0 top-0 max-w-none"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            visibility: imageVisible ? "visible" : "hidden",
          }}
        />
      </div>

      <footer className="shrink-0 border-t border-slate-800 px-6 py-2 text-center text-xs text-slate-500">
        Scroll to zoom · Hold <kbd className="rounded bg-slate-800 px-1">Space</kbd>{" "}
        and drag to pan · Double-click to zoom · Esc to close
        {canNavigate ? (
          <>
            {" "}
            · Use <kbd className="rounded bg-slate-800 px-1">←</kbd>{" "}
            <kbd className="rounded bg-slate-800 px-1">→</kbd> to switch images
          </>
        ) : null}
      </footer>
    </div>
  );
}
