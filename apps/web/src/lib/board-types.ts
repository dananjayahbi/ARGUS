import type { IssueStatus } from "./db-types";

export interface BoardIssue {
  id: string;
  issue_number: number;
  title: string;
  priority: number;
  status: IssueStatus;
  report_type: string;
  updated_at: string;
  created_at?: string;
  board_order?: number;
  description?: string | null;
  raw_image_url?: string | null;
  annotated_image_url?: string | null;
  supplementary_assets?: Array<{ url: string; asset_type: string }>;
}
