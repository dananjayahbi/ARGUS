import type { QueryResultRow } from "pg";

export type IssueStatus = "draft" | "pending" | "working" | "reconsider" | "completed";
export type ReportType = "screenshot" | "full_page" | "text_only";
export type AuthorRole = "developer" | "qa";

export interface Viewport {
  width: number;
  height: number;
}

export interface Screen {
  width: number;
  height: number;
}

export interface EnvironmentInfo {
  url?: string;
  title?: string;
  viewport?: Viewport;
  screen?: Screen;
  device_pixel_ratio?: number;
  user_agent?: string;
  os?: string;
}

export interface ConsoleLogEntry {
  type: "error" | "warn" | "network_failure";
  message: string;
  stack_or_detail?: string | null;
  timestamp: string;
}

export type CanvasState = Record<string, unknown>;

export interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IssueRow extends QueryResultRow {
  id: string;
  project_id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  status: IssueStatus;
  report_type: ReportType;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  canvas_state: CanvasState | null;
  audio_note_url: string | null;
  environment_info: EnvironmentInfo | null;
  console_logs: ConsoleLogEntry[] | null;
  ephemeral_token: string | null;
  token_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IssueReconsiderNoteRow extends QueryResultRow {
  id: string;
  issue_id: string;
  author_role: AuthorRole;
  note: string;
  attachment_urls: string[] | null;
  created_at: Date;
}

export interface IssueSupplementaryAssetRow extends QueryResultRow {
  id: string;
  issue_id: string;
  asset_url: string;
  asset_type: string;
  created_at: Date;
}
