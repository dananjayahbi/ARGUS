"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ChangeEvent } from "react";

import { ACTIVE_PROJECT_STORAGE_KEY } from "@/lib/project-preference";

export function ProjectSwitcher({
  projects,
}: {
  projects: Array<{ key: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const currentKey = pathname.startsWith("/projects/")
    ? decodeURIComponent(pathname.split("/")[2] ?? "")
    : "";

  useEffect(() => {
    if (projects.length === 0) {
      try {
        localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in restricted contexts.
      }
      return;
    }

    if (currentKey && projects.some((project) => project.key === currentKey)) {
      try {
        localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, currentKey);
      } catch {
        // Storage can be unavailable in restricted contexts.
      }
    }
  }, [currentKey, projects]);

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const key = event.target.value;
    if (!key) {
      return;
    }

    try {
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, key);
    } catch {
      // Storage can be unavailable in restricted contexts.
    }

    router.push(`/projects/${encodeURIComponent(key)}`);
  }

  return (
    <label className="flex items-center gap-2 text-xs text-teal-tint">
      <span className="sr-only">Active project</span>
      <select
        value={currentKey}
        onChange={handleChange}
        disabled={projects.length === 0}
        className="rounded-lg border border-cream/30 bg-teal-hover px-2 py-1.5 text-xs font-semibold text-cream outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="">
          {projects.length === 0 ? "No projects" : "Select project…"}
        </option>
        {projects.map((project) => (
          <option key={project.key} value={project.key}>
            {project.name} ({project.key})
          </option>
        ))}
      </select>
    </label>
  );
}
