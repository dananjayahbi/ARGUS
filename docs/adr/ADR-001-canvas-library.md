# ADR-001: Canvas annotation library and scene-graph schema

- **Status:** Accepted
- **Date:** 2026-11-06
- **Deciders:** ARGUS engineering lead, QA engineer
- **Context:** §3.3 requires an interactive annotation canvas with pan, zoom, pen, text, arrows, numbered badges, destructive PII blur, clipboard paste, and a persisted vector scene graph that can be rehydrated.

## Decision

Use **React-Konva** (`react-konva` + `konva`) for the `/canvas/[draftId]` editor.

## Why React-Konva

1. **Declarative node tree maps to `canvas_state`.** Each annotation is a React element with a stable `id`, so the serialized JSON is a direct projection of the rendered tree. Rehydration is a matter of rendering the stored nodes again.
2. **Per-node hit detection and drag.** Konva gives each node its own hit graph, which the select tool and future per-node editing need without writing a hit-testing engine.
3. **Offscreen-canvas escape hatch for destructive redaction.** The blur/pixelate tool must burn pixels irreversibly into the exported PNG. Konva exposes the layer canvas, so the redaction can be rendered to an offscreen canvas and re-encoded rather than relying on a reversible visual filter.
4. **No DOM-per-node cost.** Thousands of pen points live in one canvas rather than thousands of DOM elements.
5. **React 19 compatibility.** `react-konva` 19.x targets React 19 and the current Next.js App Router.

## Rejected alternatives

| Alternative | Why not |
| --- | --- |
| **Fabric.js** | Mature object model, but its React integration is imperative and its filter objects can be reversed at export time. The destructive-redaction requirement is harder to guarantee. |
| **Plain Canvas 2D** | Full control, but we would have to build selection, hit testing, transforms, and serialization from scratch. Too much risk for a two-person team. |
| **tldraw / Excalidraw** | Excellent editors, but heavy, opinionated about UI, and their scene formats are not the flat node list the issue schema expects. |
| **DOM/SVG overlays** | Simple for text and rectangles, but pen strokes and blur marquee performance degrade, and exporting a flattened PNG is awkward. |

## Consequences

- The editor is a client component; the Konva stage is loaded with `next/dynamic` and `ssr: false`.
- The scene graph is versioned (`version: 1`) and validated with zod before persistence.
- The CDN must send `Access-Control-Allow-Origin` so the canvas can export a tainted-free PNG.
- Destructive redaction is applied to an offscreen canvas at export time, not stored as a reversible filter.
- Future per-node editing (select, move, delete) is a natural extension of the node `id` field.

## Scene-graph schema (version 1)

```ts
type CanvasScene = {
  version: 1;
  width: number;
  height: number;
  background?: string;
  nodes: CanvasNode[];
};

type CanvasNode =
  | { id; type: "pen"; x; y; points: number[]; stroke; strokeWidth; opacity?; rotation? }
  | { id; type: "text"; x; y; text; fill; fontSize; fontFamily?; background?; padding?; width?; rotation? }
  | { id; type: "rect"; x; y; width; height; stroke; strokeWidth; fill?; rotation? }
  | { id; type: "arrow"; x; y; points: [number, number, number, number]; stroke; strokeWidth; pointerLength; pointerWidth; rotation? }
  | { id; type: "badge"; x; y; number; radius; fill; textColor; fontSize; rotation? }
  | { id; type: "blur"; x; y; width; height; method: "pixelate" | "blur"; strength; rotation? };
```

The canonical TypeScript and zod definitions live in `apps/web/src/lib/canvas-types.ts`.
