import type { QueryResultRow } from "pg";

import { DashboardLanding } from "@/components/dashboard/DashboardLanding";
import { query } from "@/lib/db";

interface ProjectSummary extends QueryResultRow {
  key: string;
  name: string;
}

export default async function DashboardPage() {
  const projects = await query<ProjectSummary>(
    "SELECT key, name FROM projects ORDER BY name",
  );

  if (projects.rows.length === 0) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-sm text-slate-400">
        No projects are available yet.
      </div>
    );
  }

  return (
    <DashboardLanding
      projects={projects.rows.map(({ key, name }) => ({ key, name }))}
    />
  );
}
