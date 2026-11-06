"use client";

import { useEffect, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Stage } from "react-konva";

import { CanvasNodeView } from "@/components/canvas/CanvasNodeView";
import { computeFitTransform } from "@/components/canvas/useCanvasViewport";
import { useLoadedImage } from "@/components/canvas/useLoadedImage";
import { parseCanvasScene } from "@/lib/canvas-types";

export function ReadOnlyCanvas({
  canvasState,
  fallbackImageUrl,
}: {
  canvasState: unknown;
  fallbackImageUrl: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scene = parseCanvasScene(canvasState);
  const { image } = useLoadedImage(
    scene?.background ?? fallbackImageUrl,
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!scene) {
    return (
      <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">
        No vector scene was saved for this issue.
      </p>
    );
  }

  const fit = computeFitTransform(
    scene.width,
    scene.height,
    Math.max(1, size.width),
    Math.max(1, size.height),
  );

  return (
    <div
      ref={containerRef}
      className="relative h-72 w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
    >
      {size.width > 0 && size.height > 0 ? (
        <Stage
          width={size.width}
          height={size.height}
          x={fit.x}
          y={fit.y}
          scaleX={fit.scale}
          scaleY={fit.scale}
        >
          <Layer>
            {image ? (
              <KonvaImage
                image={image}
                x={0}
                y={0}
                width={scene.width}
                height={scene.height}
                listening={false}
              />
            ) : null}

            {scene.nodes.map((node) => (
              <CanvasNodeView
                key={node.id}
                node={node}
                draggable={false}
                listening={false}
                backgroundImage={image}
                registerRef={() => undefined}
                onSelect={() => undefined}
                onDragEnd={() => undefined}
              />
            ))}
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
