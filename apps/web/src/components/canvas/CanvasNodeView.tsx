"use client";

import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Arrow, Circle, Group, Label, Line, Rect, Tag, Text } from "react-konva";

import type { CanvasNode } from "@/lib/canvas-types";

import { BlurNodeView } from "./BlurNodeView";

interface CanvasNodeViewProps {
  node: CanvasNode;
  draggable: boolean;
  listening: boolean;
  backgroundImage?: HTMLImageElement | null;
  registerRef: (node: Konva.Node | null) => void;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd?: (node: Konva.Node) => void;
}

export function CanvasNodeView({
  node,
  draggable,
  listening,
  backgroundImage,
  registerRef,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: CanvasNodeViewProps) {
  const handleDragEnd = (event: KonvaEventObject<DragEvent>) => {
    onDragEnd(event.target.x(), event.target.y());
  };

  const common = {
    name: "canvas-node",
    draggable,
    listening,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: handleDragEnd,
  };

  switch (node.type) {
    case "pen":
      return (
        <Line
          ref={registerRef}
          {...common}
          points={node.points}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          tension={0.35}
          lineCap="round"
          lineJoin="round"
          opacity={node.opacity ?? 1}
          hitStrokeWidth={Math.max(12, node.strokeWidth)}
        />
      );

    case "text":
      return (
        <Label ref={registerRef} {...common} x={node.x} y={node.y}>
          <Tag
            fill={node.background ?? "#fdfbf6"}
            opacity={0.92}
            cornerRadius={4}
          />
          <Text
            text={node.text}
            fill={node.fill}
            fontSize={node.fontSize}
            fontFamily={
              node.fontFamily ??
              "Inter, ui-sans-serif, system-ui, sans-serif"
            }
            padding={node.padding ?? 6}
          />
        </Label>
      );

    case "rect":
      return (
        <Rect
          ref={registerRef}
          {...common}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          fill={node.fill ?? "transparent"}
          onTransformEnd={(event) => onTransformEnd?.(event.target)}
        />
      );

    case "arrow":
      return (
        <Arrow
          ref={registerRef}
          {...common}
          x={node.x}
          y={node.y}
          points={node.points}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          fill={node.stroke}
          pointerLength={node.pointerLength}
          pointerWidth={node.pointerWidth}
          lineCap="round"
          hitStrokeWidth={Math.max(12, node.strokeWidth)}
        />
      );

    case "badge":
      return (
        <Group ref={registerRef} {...common} x={node.x} y={node.y}>
          <Circle
            radius={node.radius}
            fill={node.fill}
            stroke="#17313a"
            strokeWidth={2}
          />
          <Text
            text={String(node.number)}
            fill={node.textColor}
            fontSize={node.fontSize}
            width={node.radius * 2}
            height={node.radius * 2}
            x={-node.radius}
            y={-node.radius}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      );

    case "blur":
      return (
        <BlurNodeView
          node={node}
          image={backgroundImage ?? null}
          registerRef={registerRef}
          draggable={draggable}
          listening={listening}
          onSelect={onSelect}
          onDragEnd={onDragEnd}
        />
      );
  }
}
