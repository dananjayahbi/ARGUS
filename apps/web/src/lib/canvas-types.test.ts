import { describe, expect, it } from "vitest";

import {
  CANVAS_SCENE_VERSION,
  createEmptyScene,
  parseCanvasScene,
  serializeCanvasScene,
  type CanvasScene,
} from "./canvas-types";

describe("canvas scene schema", () => {
  it("round-trips every node kind", () => {
    const scene: CanvasScene = {
      version: CANVAS_SCENE_VERSION,
      width: 1280,
      height: 720,
      background: "https://cdn.example/raw/shot.png",
      nodes: [
        {
          id: "pen-1",
          type: "pen",
          x: 0,
          y: 0,
          points: [0, 0, 10, 10],
          stroke: "#ff0000",
          strokeWidth: 3,
        },
        {
          id: "text-1",
          type: "text",
          x: 10,
          y: 20,
          text: "Hello",
          fill: "#ffffff",
          fontSize: 18,
          background: "#000000",
          padding: 4,
        },
        {
          id: "rect-1",
          type: "rect",
          x: 1,
          y: 2,
          width: 100,
          height: 50,
          stroke: "#00ff00",
          strokeWidth: 2,
        },
        {
          id: "arrow-1",
          type: "arrow",
          x: 0,
          y: 0,
          points: [0, 0, 100, 100],
          stroke: "#ffff00",
          strokeWidth: 3,
          pointerLength: 10,
          pointerWidth: 10,
        },
        {
          id: "badge-1",
          type: "badge",
          x: 50,
          y: 50,
          number: 1,
          radius: 16,
          fill: "#06b6d4",
          textColor: "#020617",
          fontSize: 14,
        },
        {
          id: "blur-1",
          type: "blur",
          x: 10,
          y: 10,
          width: 200,
          height: 80,
          method: "pixelate",
          strength: 12,
        },
      ],
    };

    const json = JSON.parse(JSON.stringify(scene));
    expect(parseCanvasScene(json)).toEqual(scene);
    expect(serializeCanvasScene(scene)).toEqual(scene);
  });

  it("creates an empty versioned scene", () => {
    const scene = createEmptyScene(800, 600, "https://cdn.example/shot.png");

    expect(scene).toEqual({
      version: 1,
      width: 800,
      height: 600,
      background: "https://cdn.example/shot.png",
      nodes: [],
    });
  });

  it("rejects unknown versions and node types", () => {
    expect(
      parseCanvasScene({ ...createEmptyScene(10, 10), version: 2 }),
    ).toBeNull();
    expect(
      parseCanvasScene({
        ...createEmptyScene(10, 10),
        nodes: [{ id: "x", type: "sticker", x: 0, y: 0 }],
      }),
    ).toBeNull();
  });

  it("excludes viewport transforms from exported scenes", () => {
    const parsed = parseCanvasScene({
      ...createEmptyScene(10, 10),
      scale: 4,
      x: 100,
      y: 50,
    });

    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("scale");
    expect(parsed).not.toHaveProperty("x");
    expect(parsed).not.toHaveProperty("y");
  });
});
