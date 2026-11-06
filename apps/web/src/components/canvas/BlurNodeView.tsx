"use client";

import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useMemo } from "react";
import { Image as KonvaImage, Rect } from "react-konva";

import type { BlurNode } from "@/lib/canvas-types";

function createRedactedCanvas(
  image: HTMLImageElement,
  node: BlurNode,
): HTMLCanvasElement | null {
  const width = Math.max(1, Math.round(node.width));
  const height = Math.max(1, Math.round(node.height));
  if (width < 2 || height < 2) {
    return null;
  }

  const sourceX = Math.max(0, Math.round(node.x));
  const sourceY = Math.max(0, Math.round(node.y));
  const sourceWidth = Math.min(width, image.naturalWidth - sourceX);
  const sourceHeight = Math.min(height, image.naturalHeight - sourceY);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) {
    return null;
  }

  if (node.method === "pixelate") {
    const pixelSize = Math.max(2, Math.round(node.strength));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.ceil(width / pixelSize));
    small.height = Math.max(1, Math.ceil(height / pixelSize));
    const smallContext = small.getContext("2d");
    if (!smallContext) {
      return null;
    }

    smallContext.imageSmoothingEnabled = true;
    smallContext.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      small.width,
      small.height,
    );

    context.imageSmoothingEnabled = false;
    context.drawImage(
      small,
      0,
      0,
      small.width,
      small.height,
      0,
      0,
      width,
      height,
    );
  } else {
    context.filter = `blur(${Math.max(2, node.strength)}px)`;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    context.filter = "none";
  }

  return output;
}

interface BlurNodeViewProps {
  node: BlurNode;
  image: HTMLImageElement | null;
  registerRef: (node: Konva.Node | null) => void;
  draggable: boolean;
  listening: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}

export function BlurNodeView({
  node,
  image,
  registerRef,
  draggable,
  listening,
  onSelect,
  onDragEnd,
}: BlurNodeViewProps) {
  const canvas = useMemo(
    () => (image ? createRedactedCanvas(image, node) : null),
    [image, node],
  );

  const common = {
    name: "canvas-node",
    draggable,
    listening,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (event: KonvaEventObject<DragEvent>) =>
      onDragEnd(event.target.x(), event.target.y()),
  };

  if (canvas) {
    return (
      <KonvaImage
        ref={registerRef}
        {...common}
        image={canvas}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
      />
    );
  }

  return (
    <Rect
      ref={registerRef}
      {...common}
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      fill="rgba(2,6,23,0.85)"
      stroke="#f43f5e"
      strokeWidth={1}
    />
  );
}
