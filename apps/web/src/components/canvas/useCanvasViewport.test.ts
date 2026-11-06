import { describe, expect, it } from "vitest";

import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  computeFitTransform,
  panBy,
  zoomAtPoint,
} from "./useCanvasViewport";

describe("viewport math", () => {
  it("fits and centres an image", () => {
    const fit = computeFitTransform(1000, 500, 500, 500);

    expect(fit.scale).toBe(0.5);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(125);
  });

  it("does not upscale small images", () => {
    const fit = computeFitTransform(100, 100, 800, 600);

    expect(fit.scale).toBe(1);
    expect(fit.x).toBe(350);
    expect(fit.y).toBe(250);
  });

  it("keeps the point under the cursor stationary within 1 px", () => {
    const before = { scale: 1.25, x: 40, y: -15 };
    const pointer = { x: 320, y: 240 };
    const next = zoomAtPoint(before, pointer, 2.5);

    const worldBefore = {
      x: (pointer.x - before.x) / before.scale,
      y: (pointer.y - before.y) / before.scale,
    };
    const screenAfter = {
      x: worldBefore.x * next.scale + next.x,
      y: worldBefore.y * next.scale + next.y,
    };

    expect(Math.abs(screenAfter.x - pointer.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(screenAfter.y - pointer.y)).toBeLessThanOrEqual(1);
  });

  it("clamps zoom at both ends", () => {
    expect(clampScale(0.0001)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);

    const before = { scale: 1, x: 0, y: 0 };
    expect(zoomAtPoint(before, { x: 10, y: 10 }, 100).scale).toBe(MAX_SCALE);
    expect(zoomAtPoint(before, { x: 10, y: 10 }, 0.0001).scale).toBe(MIN_SCALE);
  });

  it("pans without changing the scale", () => {
    const before = { scale: 2, x: 10, y: 20 };

    expect(panBy(before, 5, -7)).toEqual({ scale: 2, x: 15, y: 13 });
  });
});
