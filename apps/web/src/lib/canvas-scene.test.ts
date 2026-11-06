import { describe, expect, it } from "vitest";

import { createEmptyScene, type BadgeNode, type CanvasScene } from "./canvas-types";
import { clampRectToBounds, nextBadgeNumber, renumberBadge } from "./canvas-scene";

function badge(id: string, number: number): BadgeNode {
  return {
    id,
    type: "badge",
    x: 0,
    y: 0,
    number,
    radius: 16,
    fill: "#06b6d4",
    textColor: "#020617",
    fontSize: 14,
  };
}

function sceneWith(...badges: BadgeNode[]): CanvasScene {
  return { ...createEmptyScene(100, 100), nodes: badges };
}

describe("badge numbering", () => {
  it("starts at 1 and increments past the highest existing number", () => {
    expect(nextBadgeNumber(createEmptyScene(10, 10))).toBe(1);
    expect(nextBadgeNumber(sceneWith(badge("a", 1)))).toBe(2);
    expect(nextBadgeNumber(sceneWith(badge("a", 1), badge("b", 3)))).toBe(4);
  });

  it("swaps numbers when renumbering would duplicate one", () => {
    const scene = sceneWith(badge("a", 1), badge("b", 2));
    const updated = renumberBadge(scene, "a", 2);

    const numbers = updated.nodes
      .filter((node): node is BadgeNode => node.type === "badge")
      .map((node) => node.number);

    expect(numbers).toEqual([2, 1]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("ignores invalid numbers and no-op changes", () => {
    const scene = sceneWith(badge("a", 1));

    expect(renumberBadge(scene, "a", 0)).toBe(scene);
    expect(renumberBadge(scene, "a", 1.5)).toBe(scene);
    expect(renumberBadge(scene, "a", 1)).toBe(scene);
  });
});

describe("redaction bounds", () => {
  it("clamps a marquee that starts outside the image", () => {
    expect(clampRectToBounds({ x: -50, y: -20 }, { x: 60, y: 40 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 40,
    });
  });

  it("clamps a marquee that ends outside the image", () => {
    expect(clampRectToBounds({ x: 20, y: 20 }, { x: 200, y: 300 }, 100, 100)).toEqual({
      x: 20,
      y: 20,
      width: 80,
      height: 80,
    });
  });

  it("normalises a reverse drag", () => {
    expect(clampRectToBounds({ x: 80, y: 70 }, { x: 20, y: 10 }, 100, 100)).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 60,
    });
  });
});
