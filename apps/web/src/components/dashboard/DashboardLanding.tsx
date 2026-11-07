"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  ACTIVE_PROJECT_STORAGE_KEY,
  resolveDashboardProjectKey,
} from "@/lib/project-preference";

export function DashboardLanding({
  projects,
}: {
  projects: Array<{ key: string; name: string }>;
}) {
  const router = useRouter();

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in restricted contexts.
    }

    const key = resolveDashboardProjectKey(
      stored,
      projects.map((project) => project.key),
    );

    if (!key) {
      return;
    }

    try {
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, key);
    } catch {
      // Storage can be unavailable in restricted contexts.
    }

    router.replace(`/projects/${encodeURIComponent(key)}`);
  }, [projects, router]);

  return (
    <div className="grid min-h-[50vh] place-items-center text-sm text-muted">
      Opening your last project…
    </div>
  );
}
