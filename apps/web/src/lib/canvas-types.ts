import { z } from "zod";

export const CANVAS_SCENE_VERSION = 1;

const nodeBaseSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  rotation: z.number().optional(),
});

export const penNodeSchema = nodeBaseSchema.extend({
  type: z.literal("pen"),
  points: z.array(z.number()),
  stroke: z.string().min(1),
  strokeWidth: z.number().positive(),
  opacity: z.number().min(0).max(1).optional(),
});

export const textNodeSchema = nodeBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  fill: z.string().min(1),
  fontSize: z.number().positive(),
  fontFamily: z.string().min(1).optional(),
  background: z.string().min(1).optional(),
  padding: z.number().min(0).optional(),
  width: z.number().positive().optional(),
});

export const rectNodeSchema = nodeBaseSchema.extend({
  type: z.literal("rect"),
  width: z.number().positive(),
  height: z.number().positive(),
  stroke: z.string().min(1),
  strokeWidth: z.number().positive(),
  fill: z.string().optional(),
});

export const arrowNodeSchema = nodeBaseSchema.extend({
  type: z.literal("arrow"),
  points: z.array(z.number()).length(4),
  stroke: z.string().min(1),
  strokeWidth: z.number().positive(),
  pointerLength: z.number().positive(),
  pointerWidth: z.number().positive(),
});

export const badgeNodeSchema = nodeBaseSchema.extend({
  type: z.literal("badge"),
  number: z.number().int().positive(),
  radius: z.number().positive(),
  fill: z.string().min(1),
  textColor: z.string().min(1),
  fontSize: z.number().positive(),
});

export const blurNodeSchema = nodeBaseSchema.extend({
  type: z.literal("blur"),
  width: z.number().positive(),
  height: z.number().positive(),
  method: z.enum(["pixelate", "blur"]),
  strength: z.number().positive(),
});

export const canvasNodeSchema = z.discriminatedUnion("type", [
  penNodeSchema,
  textNodeSchema,
  rectNodeSchema,
  arrowNodeSchema,
  badgeNodeSchema,
  blurNodeSchema,
]);

export const canvasSceneSchema = z.object({
  version: z.literal(CANVAS_SCENE_VERSION),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string().optional(),
  nodes: z.array(canvasNodeSchema),
});

export type PenNode = z.infer<typeof penNodeSchema>;
export type TextNode = z.infer<typeof textNodeSchema>;
export type RectNode = z.infer<typeof rectNodeSchema>;
export type ArrowNode = z.infer<typeof arrowNodeSchema>;
export type BadgeNode = z.infer<typeof badgeNodeSchema>;
export type BlurNode = z.infer<typeof blurNodeSchema>;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasScene = z.infer<typeof canvasSceneSchema>;

export type CanvasTool =
  | "select"
  | "pen"
  | "text"
  | "rect"
  | "arrow"
  | "badge"
  | "blur";

export interface CanvasDraftData {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  report_type: string;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  audio_note_url: string | null;
  canvas_state: unknown;
  environment_info: unknown;
  console_logs: unknown;
  supplementary_assets: Array<{ url: string; asset_type: string }>;
  project_key: string;
  project_name: string;
}

export function createEmptyScene(
  width: number,
  height: number,
  background?: string,
): CanvasScene {
  return {
    version: CANVAS_SCENE_VERSION,
    width,
    height,
    ...(background ? { background } : {}),
    nodes: [],
  };
}

export function parseCanvasScene(value: unknown): CanvasScene | null {
  const parsed = canvasSceneSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function serializeCanvasScene(scene: CanvasScene): CanvasScene {
  return canvasSceneSchema.parse(scene);
}
