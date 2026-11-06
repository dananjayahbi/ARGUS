import type { BadgeNode, CanvasNode, CanvasScene } from "./canvas-types";

export function nextBadgeNumber(scene: CanvasScene): number {
  const numbers = scene.nodes
    .filter((node): node is BadgeNode => node.type === "badge")
    .map((node) => node.number);

  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/**
 * Renumber a badge. If the requested number is already taken, the two badges
 * swap numbers so the scene never contains duplicates.
 */
export function renumberBadge(
  scene: CanvasScene,
  id: string,
  number: number,
): CanvasScene {
  if (!Number.isInteger(number) || number < 1) {
    return scene;
  }

  const target = scene.nodes.find(
    (node): node is BadgeNode => node.type === "badge" && node.id === id,
  );

  if (!target || target.number === number) {
    return scene;
  }

  const conflict = scene.nodes.find(
    (node): node is BadgeNode =>
      node.type === "badge" && node.id !== id && node.number === number,
  );

  return {
    ...scene,
    nodes: scene.nodes.map((node) => {
      if (node.type !== "badge") {
        return node;
      }
      if (node.id === id) {
        return { ...node, number };
      }
      if (conflict && node.id === conflict.id) {
        return { ...node, number: target.number };
      }
      return node;
    }),
  };
}

export function updateSceneNode(
  scene: CanvasScene,
  id: string,
  updater: (node: CanvasNode) => CanvasNode,
): CanvasScene {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => (node.id === id ? updater(node) : node)),
  };
}

export function removeSceneNode(scene: CanvasScene, id: string): CanvasScene {
  return {
    ...scene,
    nodes: scene.nodes.filter((node) => node.id !== id),
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a marquee to the image bounds so redaction cannot target outside it. */
export function clampRectToBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  boundsWidth: number,
  boundsHeight: number,
): Rect {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(boundsWidth, Math.max(start.x, end.x));
  const bottom = Math.min(boundsHeight, Math.max(start.y, end.y));

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
