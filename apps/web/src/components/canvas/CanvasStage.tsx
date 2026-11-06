"use client";

import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useEffect, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Stage, Transformer } from "react-konva";

import { clampRectToBounds, nextBadgeNumber } from "@/lib/canvas-scene";
import type {
  BlurNode,
  CanvasNode,
  CanvasScene,
  CanvasTool,
} from "@/lib/canvas-types";

import { CanvasNodeView } from "./CanvasNodeView";
import { useLoadedImage } from "./useLoadedImage";
import type { CanvasViewport, Point } from "./useCanvasViewport";

interface Size {
  width: number;
  height: number;
}

export function CanvasStage({
  imageUrl,
  viewport,
  spacePressed,
  isPanning,
  activeTool,
  scene,
  selectedId,
  penColor,
  penWidth,
  blurMethod,
  blurStrength,
  onSelect,
  onAddNode,
  onUpdateNode,
  onRequestRedaction,
  onImageSize,
  registerFlatten,
}: {
  imageUrl: string | null;
  viewport: CanvasViewport;
  spacePressed: boolean;
  isPanning: boolean;
  activeTool: CanvasTool;
  scene: CanvasScene;
  selectedId: string | null;
  penColor: string;
  penWidth: number;
  blurMethod: "pixelate" | "blur";
  blurStrength: number;
  onSelect: (id: string | null) => void;
  onAddNode: (node: CanvasNode) => void;
  onUpdateNode: (
    id: string,
    updater: (node: CanvasNode) => CanvasNode,
  ) => void;
  onRequestRedaction: (node: BlurNode) => void;
  onImageSize: (width: number, height: number) => void;
  registerFlatten: (fn: (() => string | null) | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const { image, error } = useLoadedImage(imageUrl);
  const initializedRef = useRef(false);
  const { fit } = viewport;

  const [draft, setDraft] = useState<CanvasNode | null>(null);
  const draftRef = useRef<CanvasNode | null>(null);
  const drawStart = useRef<Point | null>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const setDraftNode = (node: CanvasNode | null) => {
    draftRef.current = node;
    setDraft(node);
  };

  const toWorld = (pointer: Point): Point => ({
    x: (pointer.x - viewport.transform.x) / viewport.transform.scale,
    y: (pointer.y - viewport.transform.y) / viewport.transform.scale,
  });

  const getPointer = (
    event: KonvaEventObject<MouseEvent | WheelEvent>,
  ): Point | null => {
    const stage = event.target.getStage();
    if (!stage) {
      return null;
    }

    const tracked = stage.getPointerPosition();
    if (tracked) {
      return tracked;
    }

    const rect = stage.content.getBoundingClientRect();
    return {
      x: event.evt.clientX - rect.left,
      y: event.evt.clientY - rect.top,
    };
  };

  useEffect(() => {
    initializedRef.current = false;
  }, [imageUrl]);

  useEffect(() => {
    if (
      !image ||
      size.width === 0 ||
      size.height === 0 ||
      initializedRef.current
    ) {
      return;
    }

    fit(image.width, image.height, size.width, size.height);
    onImageSize(image.width, image.height);
    initializedRef.current = true;
  }, [fit, image, onImageSize, size]);

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

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    const selected = selectedId ? nodeRefs.current.get(selectedId) : null;
    transformer.nodes(selected ? [selected] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, scene.nodes]);

  useEffect(() => {
    registerFlatten(() => {
      const stage = stageRef.current;
      if (!stage || !image) {
        return null;
      }

      const previous = {
        x: stage.x(),
        y: stage.y(),
        scaleX: stage.scaleX(),
        scaleY: stage.scaleY(),
      };
      const transformer = transformerRef.current;
      const transformerVisible = transformer?.visible() ?? false;

      stage.position({ x: 0, y: 0 });
      stage.scale({ x: 1, y: 1 });
      transformer?.visible(false);

      let dataUrl: string | null = null;
      try {
        dataUrl = stage.toDataURL({
          pixelRatio: 1,
          width: image.width,
          height: image.height,
          mimeType: "image/png",
        });
      } finally {
        transformer?.visible(transformerVisible);
        stage.position({ x: previous.x, y: previous.y });
        stage.scale({ x: previous.scaleX, y: previous.scaleY });
        stage.batchDraw();
      }

      return dataUrl;
    });

    return () => registerFlatten(null);
  }, [image, registerFlatten]);

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = getPointer(event);
    if (!pointer) {
      return;
    }

    const factor = event.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
    viewport.zoom(pointer, viewport.transform.scale * factor);
  };

  const handlePointerDown = (event: KonvaEventObject<MouseEvent>) => {
    const pointer = getPointer(event);
    if (!pointer) {
      return;
    }

    if (spacePressed) {
      event.evt.preventDefault();
      viewport.beginPan(pointer);
      return;
    }

    if (activeTool === "select") {
      return;
    }

    const world = toWorld(pointer);

    if (activeTool === "text") {
      onAddNode({
        id: crypto.randomUUID(),
        type: "text",
        x: world.x,
        y: world.y,
        text: "Text",
        fill: "#f8fafc",
        fontSize: 18,
        background: "#020617",
        padding: 6,
      });
      return;
    }

    if (activeTool === "badge") {
      onAddNode({
        id: crypto.randomUUID(),
        type: "badge",
        x: world.x,
        y: world.y,
        number: nextBadgeNumber(scene),
        radius: 16,
        fill: "#06b6d4",
        textColor: "#020617",
        fontSize: 14,
      });
      return;
    }

    drawStart.current = world;

    if (activeTool === "pen") {
      setDraftNode({
        id: crypto.randomUUID(),
        type: "pen",
        x: 0,
        y: 0,
        points: [world.x, world.y],
        stroke: penColor,
        strokeWidth: penWidth,
      });
    } else if (activeTool === "arrow") {
      setDraftNode({
        id: crypto.randomUUID(),
        type: "arrow",
        x: world.x,
        y: world.y,
        points: [0, 0, 0, 0],
        stroke: penColor,
        strokeWidth: penWidth,
        pointerLength: Math.max(8, penWidth * 4),
        pointerWidth: Math.max(8, penWidth * 4),
      });
    } else if (activeTool === "rect") {
      setDraftNode({
        id: crypto.randomUUID(),
        type: "rect",
        x: world.x,
        y: world.y,
        width: 1,
        height: 1,
        stroke: penColor,
        strokeWidth: penWidth,
      });
    } else if (activeTool === "blur") {
      if (!image || scene.width <= 0 || scene.height <= 0) {
        drawStart.current = null;
        return;
      }

      const rect = clampRectToBounds(world, world, scene.width, scene.height);
      setDraftNode({
        id: crypto.randomUUID(),
        type: "blur",
        ...rect,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        method: blurMethod,
        strength: blurStrength,
      });
    }
  };

  const handlePointerMove = (event: KonvaEventObject<MouseEvent>) => {
    const pointer = getPointer(event);
    if (!pointer) {
      return;
    }

    if (isPanning) {
      viewport.movePan(pointer);
      return;
    }

    const current = draftRef.current;
    const start = drawStart.current;
    if (!current || !start) {
      return;
    }

    const world = toWorld(pointer);

    if (current.type === "pen") {
      setDraftNode({
        ...current,
        points: [...current.points, world.x, world.y],
      });
    } else if (current.type === "arrow") {
      setDraftNode({
        ...current,
        points: [0, 0, world.x - start.x, world.y - start.y],
      });
    } else if (current.type === "rect") {
      setDraftNode({
        ...current,
        x: Math.min(start.x, world.x),
        y: Math.min(start.y, world.y),
        width: Math.max(1, Math.abs(world.x - start.x)),
        height: Math.max(1, Math.abs(world.y - start.y)),
      });
    } else if (current.type === "blur") {
      const rect = clampRectToBounds(
        start,
        world,
        scene.width,
        scene.height,
      );
      setDraftNode({
        ...current,
        ...rect,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    }
  };

  const handlePointerUp = () => {
    if (isPanning) {
      viewport.endPan();
      return;
    }

    const current = draftRef.current;
    if (!current) {
      return;
    }

    if (current.type === "blur") {
      const rect = clampRectToBounds(
        { x: current.x, y: current.y },
        { x: current.x + current.width, y: current.y + current.height },
        scene.width,
        scene.height,
      );

      if (rect.width >= 8 && rect.height >= 8) {
        onRequestRedaction({ ...current, ...rect });
      }

      setDraftNode(null);
      drawStart.current = null;
      return;
    }

    const keep =
      current.type === "pen"
        ? current.points.length >= 4
        : current.type === "arrow"
          ? Math.hypot(current.points[2], current.points[3]) >= 4
          : current.type === "rect"
            ? current.width >= 4 && current.height >= 4
            : true;

    if (keep) {
      onAddNode(current);
    }
    setDraftNode(null);
    drawStart.current = null;
  };

  const handlePointerLeave = () => {
    if (isPanning) {
      viewport.endPan();
    }
    if (draftRef.current) {
      setDraftNode(null);
      drawStart.current = null;
    }
  };

  const handleStageClick = (event: KonvaEventObject<MouseEvent>) => {
    if (spacePressed || activeTool !== "select") {
      return;
    }
    if (event.target === event.target.getStage()) {
      onSelect(null);
    }
  };

  const cursor = spacePressed
    ? isPanning
      ? "grabbing"
      : "grab"
    : activeTool === "select"
      ? "default"
      : "crosshair";

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      {error ? (
        <p className="absolute inset-x-0 top-16 z-10 text-center text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      {!imageUrl ? (
        <p className="absolute inset-x-0 top-16 z-10 text-center text-sm text-slate-400">
          Text-only report: no screenshot attached.
        </p>
      ) : null}

      {size.width > 0 && size.height > 0 ? (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={viewport.transform.x}
          y={viewport.transform.y}
          scaleX={viewport.transform.scale}
          scaleY={viewport.transform.scale}
          onWheel={handleWheel}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerLeave}
          onClick={handleStageClick}
          style={{ cursor }}
        >
          <Layer>
            {image ? (
              <KonvaImage
                image={image}
                x={0}
                y={0}
                width={image.width}
                height={image.height}
                listening={false}
              />
            ) : null}

            {scene.nodes.map((node) => (
              <CanvasNodeView
                key={node.id}
                node={node}
                backgroundImage={image}
                draggable={activeTool === "select" && !spacePressed}
                listening={activeTool === "select" && !spacePressed}
                registerRef={(konvaNode) => {
                  if (konvaNode) {
                    nodeRefs.current.set(node.id, konvaNode);
                  } else {
                    nodeRefs.current.delete(node.id);
                  }
                }}
                onSelect={() => onSelect(node.id)}
                onDragEnd={(x, y) =>
                  onUpdateNode(node.id, (current) => ({ ...current, x, y }))
                }
                onTransformEnd={(konvaNode) => {
                  if (node.type !== "rect") {
                    return;
                  }
                  const scaleX = konvaNode.scaleX();
                  const scaleY = konvaNode.scaleY();
                  konvaNode.scaleX(1);
                  konvaNode.scaleY(1);
                  onUpdateNode(node.id, (current) =>
                    current.type === "rect"
                      ? {
                          ...current,
                          width: Math.max(1, current.width * scaleX),
                          height: Math.max(1, current.height * scaleY),
                        }
                      : current,
                  );
                }}
              />
            ))}

            {draft ? (
              <CanvasNodeView
                node={draft}
                backgroundImage={image}
                draggable={false}
                listening={false}
                registerRef={() => undefined}
                onSelect={() => undefined}
                onDragEnd={() => undefined}
              />
            ) : null}

            {selectedId ? (
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                resizeEnabled={
                  scene.nodes.find((node) => node.id === selectedId)?.type ===
                  "rect"
                }
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
                }
                anchorSize={8}
                borderStroke="#22d3ee"
                anchorStroke="#22d3ee"
                anchorFill="#020617"
              />
            ) : null}
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
