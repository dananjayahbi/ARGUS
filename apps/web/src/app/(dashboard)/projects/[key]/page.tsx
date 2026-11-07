import { notFound } from "next/navigation";
import type { QueryResultRow } from "pg";

import { KanbanBoard } from "@/components/dashboard/KanbanBoard";
import type { BoardIssue } from "@/lib/board-types";
import { query } from "@/lib/db";

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
}

interface IssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  report_type: string;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  updated_at: Date;
  created_at: Date;
  board_order: number;
}

interface SupplementaryRow extends QueryResultRow {
  issue_id: string;
  asset_url: string;
  asset_type: string;
  created_at: Date;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  const projectResult = await query<ProjectRow>(
    "SELECT id, name, key, description FROM projects WHERE key = $1",
    [key],
  );
  const project = projectResult.rows[0];

  if (!project) {
    notFound();
  }

  const issuesResult = await query<IssueRow>(
    `SELECT id, issue_number, title, description, priority, status, report_type, raw_image_url, annotated_image_url, updated_at, created_at, board_order
       FROM issues
      WHERE project_id = $1
      ORDER BY status, board_order, issue_number`,
    [project.id],
  );

  const issueIds = issuesResult.rows.map((issue) => issue.id);
  const supplementaryByIssue = new Map<
    string,
    Array<{ url: string; asset_type: string }>
  >();

  if (issueIds.length > 0) {
    const supplementaryResult = await query<SupplementaryRow>(
      `SELECT issue_id, asset_url, asset_type, created_at
         FROM issue_supplementary_assets
        WHERE issue_id = ANY($1::uuid[])
        ORDER BY issue_id, created_at ASC`,
      [issueIds],
    );

    for (const row of supplementaryResult.rows) {
      const list = supplementaryByIssue.get(row.issue_id) ?? [];
      list.push({ url: row.asset_url, asset_type: row.asset_type });
      supplementaryByIssue.set(row.issue_id, list);
    }
  }

  const issues: BoardIssue[] = issuesResult.rows.map((issue) => ({
    id: issue.id,
    issue_number: issue.issue_number,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    status: issue.status as BoardIssue["status"],
    report_type: issue.report_type,
    raw_image_url: issue.raw_image_url,
    annotated_image_url: issue.annotated_image_url,
    supplementary_assets: supplementaryByIssue.get(issue.id) ?? [],
    updated_at: issue.updated_at.toISOString(),
    created_at: issue.created_at.toISOString(),
    board_order: issue.board_order,
  }));

  return (
    <KanbanBoard
      projectName={project.name}
      projectKey={project.key}
      projectDescription={project.description}
      initialIssues={issues}
    />
  );
}
