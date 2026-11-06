import { notFound } from "next/navigation";
import type { QueryResultRow } from "pg";

import { KanbanBoard } from "@/components/dashboard/KanbanBoard";
import type { BoardIssue } from "@/lib/board-types";
import { query } from "@/lib/db";

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  key: string;
}

interface IssueRow extends QueryResultRow {
  id: string;
  issue_number: number;
  title: string;
  priority: number;
  status: string;
  report_type: string;
  updated_at: Date;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  const projectResult = await query<ProjectRow>(
    "SELECT id, name, key FROM projects WHERE key = $1",
    [key],
  );
  const project = projectResult.rows[0];

  if (!project) {
    notFound();
  }

  const issuesResult = await query<IssueRow>(
    `SELECT id, issue_number, title, priority, status, report_type, updated_at
       FROM issues
      WHERE project_id = $1
      ORDER BY priority DESC, created_at DESC`,
    [project.id],
  );

  const issues: BoardIssue[] = issuesResult.rows.map((issue) => ({
    id: issue.id,
    issue_number: issue.issue_number,
    title: issue.title,
    priority: issue.priority,
    status: issue.status as BoardIssue["status"],
    report_type: issue.report_type,
    updated_at: issue.updated_at.toISOString(),
  }));

  return (
    <KanbanBoard
      projectName={project.name}
      projectKey={project.key}
      initialIssues={issues}
    />
  );
}
