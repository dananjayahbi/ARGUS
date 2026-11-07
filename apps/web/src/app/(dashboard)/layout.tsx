import Image from "next/image";
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
    <div className="min-h-screen bg-cream text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-teal-hover bg-teal px-6 py-3 text-cream">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/argus-logo.png"
              alt=""
              width={30}
              height={30}
              priority
              className="rounded-full"
            />
            <span className="text-sm font-bold tracking-[0.16em] text-cream">
              ARGUS
            </span>
          </Link>
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-teal-tint">
            Dashboard
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConfigurationsButton
            projects={projects.rows.map(({ key, name }) => ({ key, name }))}
          />
          <ProjectCreateButton />
          <ProjectSwitcher
            projects={projects.rows.map(({ key, name }) => ({ key, name }))}
          />
          <span className="text-xs text-teal-tint">
            {session.user.email} · {session.user.role}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
