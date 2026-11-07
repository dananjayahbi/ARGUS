import Link from "next/link";
import type { QueryResultRow } from "pg";

import { ConfigurationsButton } from "@/components/dashboard/ConfigurationsButton";
import { ProjectCreateButton } from "@/components/dashboard/ProjectCreateButton";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/session";

interface ProjectOption extends QueryResultRow {
  key: string;
  name: string;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const projects = await query<ProjectOption>(
    "SELECT key, name FROM projects ORDER BY name",
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-[0.3em] text-cyan-400"
          >
            ARGUS
          </Link>
          <span className="text-sm text-slate-400">Dashboard</span>
        </div>

        <div className="flex items-center gap-3">
          <ConfigurationsButton
            projects={projects.rows.map(({ key, name }) => ({ key, name }))}
          />
          <ProjectCreateButton />
          <ProjectSwitcher
            projects={projects.rows.map(({ key, name }) => ({ key, name }))}
          />
          <span className="text-xs text-slate-400">
            {session.user.email} · {session.user.role}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="p-6">{children}</main>
    </div>
  );
}
