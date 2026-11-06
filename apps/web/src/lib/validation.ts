import { z } from "zod";

const isoDateString = z
  .string()
  .min(1)
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "timestamp must be a valid ISO-8601 string",
  );

const dimensionSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const environmentInfoSchema = z
  .object({
    url: z.string().min(1).optional(),
    title: z.string().optional(),
    viewport: dimensionSchema.optional(),
    screen: dimensionSchema.optional(),
    device_pixel_ratio: z.number().positive().optional(),
    user_agent: z.string().optional(),
    os: z.string().optional(),
  })
  .passthrough();

export const consoleLogSchema = z
  .object({
    type: z.enum(["error", "warn", "network_failure"]),
    message: z.string(),
    stack_or_detail: z.string().nullable().optional(),
    timestamp: isoDateString,
  })
  .passthrough();

export const ingestDraftSchema = z
  .object({
    project_id: z.string().uuid("project_id must be a UUID"),
    report_type: z.enum(["screenshot", "full_page", "text_only"]),
    raw_image_url: z
      .string()
      .url("raw_image_url must be an absolute URL")
      .nullable()
      .optional(),
    environment_info: environmentInfoSchema.nullable().optional(),
    console_logs: z
      .array(consoleLogSchema)
      .max(50, "console_logs accepts at most 50 entries")
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.report_type !== "text_only" && !value.raw_image_url) {
      context.addIssue({
        code: "custom",
        path: ["raw_image_url"],
        message: "raw_image_url is required unless report_type is text_only",
      });
    }
  });

export type IngestDraftInput = z.infer<typeof ingestDraftSchema>;

export const finalizeIssueSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "title is required")
      .max(255, "title must be at most 255 characters"),
    description: z.string().nullable().optional(),
    priority: z
      .number()
      .min(0, "priority must be between 0 and 100")
      .max(100, "priority must be between 0 and 100")
      .refine(Number.isInteger, "priority must be an integer"),
    annotated_image_url: z
      .string()
      .url("annotated_image_url must be an absolute URL")
      .nullable()
      .optional(),
    raw_image_url: z
      .string()
      .url("raw_image_url must be an absolute URL")
      .nullable()
      .optional(),
    canvas_state: z.record(z.string(), z.unknown()).nullable().optional(),
    audio_note_url: z
      .string()
      .url("audio_note_url must be an absolute URL")
      .nullable()
      .optional(),
    supplementary_assets: z
      .array(
        z.object({
          url: z
            .string()
            .url("supplementary asset url must be an absolute URL"),
          asset_type: z.string().min(1, "asset_type is required"),
        }),
      )
      .max(20, "at most 20 supplementary assets")
      .optional(),
  })
  .strict();

export type FinalizeIssueInput = z.infer<typeof finalizeIssueSchema>;
