"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export interface Point {
  x: number;
  y: number;
}

export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export function clampScale(
  scale: number,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
): number {
  return Math.min(maxScale, Math.max(minScale, scale));
}

export function computeFitTransform(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewportTransform {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }

  const scale = Math.min(
    viewportWidth / imageWidth,
    viewportHeight / imageHeight,
    1,
  );

  return {
    scale,
    x: (viewportWidth - imageWidth * scale) / 2,
    y: (viewportHeight - imageHeight * scale) / 2,
  };
}

/**
 * Zoom around a screen-space pointer. The world point under the pointer is
 * solved before the scale change and projected back afterwards, which keeps it
 * stationary regardless of the current pan offset.
 */
export function zoomAtPoint(
  transform: ViewportTransform,
  pointer: Point,
  nextScale: number,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
): ViewportTransform {
  const scale = clampScale(nextScale, minScale, maxScale);
  const worldX = (pointer.x - transform.x) / transform.scale;
  const worldY = (pointer.y - transform.y) / transform.scale;

  return {
    scale,
    x: pointer.x - worldX * scale,
    y: pointer.y - worldY * scale,
  };
}

export function panBy(
  transform: ViewportTransform,
  dx: number,
  dy: number,
): ViewportTransform {
  return {
    ...transform,
    x: transform.x + dx,
    y: transform.y + dy,
  };
}

export function useCanvasViewport() {
  const [transform, setTransform] = useState<ViewportTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [minScale, setMinScale] = useState(MIN_SCALE);

  const lastPointer = useRef<Point | null>(null);
  const lastFit = useRef<ViewportTransform | null>(null);

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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditable(event.target)) {
        return;
      }
      event.preventDefault();
      setSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditable(event.target)) {
        return;
      }
      event.preventDefault();
      setSpacePressed(false);
      setIsPanning(false);
      lastPointer.current = null;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const fit = useCallback(
    (
      imageWidth: number,
      imageHeight: number,
      viewportWidth: number,
      viewportHeight: number,
    ) => {
      const next = computeFitTransform(
        imageWidth,
        imageHeight,
        viewportWidth,
        viewportHeight,
      );
      lastFit.current = next;
      setMinScale(Math.min(MIN_SCALE, next.scale));
      setTransform(next);
    },
    [],
  );

  const resetToFit = useCallback(() => {
    if (lastFit.current) {
      setTransform(lastFit.current);
    }
  }, []);

  const zoom = useCallback(
    (pointer: Point, nextScale: number) => {
      setTransform((current) =>
        zoomAtPoint(current, pointer, nextScale, minScale, MAX_SCALE),
      );
    },
    [minScale],
  );

  const beginPan = useCallback((pointer: Point) => {
    lastPointer.current = pointer;
    setIsPanning(true);
  }, []);

  const movePan = useCallback((pointer: Point) => {
    const previous = lastPointer.current;
    if (!previous) {
      return;
    }
    lastPointer.current = pointer;
    setTransform((current) =>
      panBy(current, pointer.x - previous.x, pointer.y - previous.y),
    );
  }, []);

  const endPan = useCallback(() => {
    lastPointer.current = null;
    setIsPanning(false);
  }, []);

  return {
    transform,
    spacePressed,
    isPanning,
    fit,
    resetToFit,
    zoom,
    beginPan,
    movePan,
    endPan,
  };
}

export type CanvasViewport = ReturnType<typeof useCanvasViewport>;
