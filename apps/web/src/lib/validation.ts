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

export const supplementaryAssetSchema = z.object({
  url: z.string().url("supplementary asset url must be an absolute URL"),
  asset_type: z.string().min(1, "asset_type is required"),
});

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
    supplementary_assets: z
      .array(supplementaryAssetSchema)
      .max(200, "at most 200 supplementary assets")
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

export const issueStatusSchema = z.enum([
  "draft",
  "pending",
  "working",
  "reconsider",
  "completed",
]);

export const directIssueStatusSchema = z.enum([
  "draft",
  "pending",
  "working",
  "completed",
]);

export const createIssueSchema = z
  .object({
    project_key: z.string().trim().min(1).max(10),
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
      .refine(Number.isInteger, "priority must be an integer")
      .optional()
      .default(50),
    status: directIssueStatusSchema.default("pending"),
    report_type: z.enum(["screenshot", "full_page", "text_only"]).default("text_only"),
    raw_image_url: z
      .string()
      .url("raw_image_url must be an absolute URL")
      .nullable()
      .optional(),
    annotated_image_url: z
      .string()
      .url("annotated_image_url must be an absolute URL")
      .nullable()
      .optional(),
    audio_note_url: z
      .string()
      .url("audio_note_url must be an absolute URL")
      .nullable()
      .optional(),
    supplementary_assets: z
      .array(supplementaryAssetSchema)
      .max(20, "at most 20 supplementary assets")
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.report_type === "screenshot" || value.report_type === "full_page") &&
      !value.raw_image_url &&
      !value.annotated_image_url
    ) {
      context.addIssue({
        code: "custom",
        path: ["raw_image_url"],
        message:
          "raw_image_url or annotated_image_url is required for screenshot reports",
      });
    }
  });

export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "title is required")
      .max(255, "title must be at most 255 characters")
      .optional(),
    description: z.string().nullable().optional(),
    priority: z
      .number()
      .min(0, "priority must be between 0 and 100")
      .max(100, "priority must be between 0 and 100")
      .refine(Number.isInteger, "priority must be an integer")
      .optional(),
    status: directIssueStatusSchema.optional(),
    report_type: z.enum(["screenshot", "full_page", "text_only"]).optional(),
    raw_image_url: z
      .string()
      .url("raw_image_url must be an absolute URL")
      .nullable()
      .optional(),
    annotated_image_url: z
      .string()
      .url("annotated_image_url must be an absolute URL")
      .nullable()
      .optional(),
    audio_note_url: z
      .string()
      .url("audio_note_url must be an absolute URL")
      .nullable()
      .optional(),
    supplementary_assets: z
      .array(supplementaryAssetSchema)
      .max(20, "at most 20 supplementary assets")
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.status !== undefined ||
      value.report_type !== undefined ||
      value.raw_image_url !== undefined ||
      value.annotated_image_url !== undefined ||
      value.audio_note_url !== undefined ||
      value.supplementary_assets !== undefined,
    "Provide at least one field to update",
  );

export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const issuePositionSchema = z
  .object({
    status: directIssueStatusSchema,
    previous_issue_id: z.string().uuid().nullable().optional(),
    next_issue_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.previous_issue_id ||
      !value.next_issue_id ||
      value.previous_issue_id !== value.next_issue_id,
    "previous_issue_id and next_issue_id must be different",
  );

export type IssuePositionInput = z.infer<typeof issuePositionSchema>;

export const createProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name is required")
      .max(100, "name must be at most 100 characters"),
    key: z
      .string()
      .trim()
      .min(1, "key is required")
      .max(10, "key must be at most 10 characters")
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
        "key may only contain letters, numbers, dashes and underscores",
      ),
    description: z.string().nullable().optional(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name is required")
      .max(100, "name must be at most 100 characters")
      .optional(),
    description: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    "Provide at least one field to update",
  );

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const commentAttachmentSchema = z.object({
  url: z.string().url("attachment url must be an absolute URL"),
  asset_type: z.string().min(1, "asset_type is required").max(100),
  file_name: z.string().max(255).nullable().optional(),
  size_bytes: z
    .number()
    .int()
    .nonnegative("size_bytes must be zero or greater")
    .nullable()
    .optional(),
});

export type CommentAttachmentInput = z.infer<typeof commentAttachmentSchema>;

export const createCommentSchema = z
  .object({
    body: z
      .string()
      .max(20000, "body must be at most 20000 characters")
      .optional()
      .default(""),
    attachments: z
      .array(commentAttachmentSchema)
      .max(20, "at most 20 attachments per comment")
      .optional()
      .default([]),
  })
  .strict()
  .refine(
    (value) => value.body.trim().length > 0 || value.attachments.length > 0,
    "A comment body or at least one attachment is required",
  );

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100).optional(),
    all: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.all === true || (value.ids?.length ?? 0) > 0,
    "Provide notification ids or set all=true",
  );

export type MarkNotificationsReadInput = z.infer<
  typeof markNotificationsReadSchema
>;
