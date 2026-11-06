import type { IssueStatus } from "./db-types";

export interface BoardIssue {
  id: string;
  issue_number: number;
  title: string;
  priority: number;
  status: IssueStatus;
  report_type: string;
  updated_at: string;
}
