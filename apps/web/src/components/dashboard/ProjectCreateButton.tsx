"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProjectFormModal } from "./ProjectFormModal";

export function ProjectCreateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-accent bg-accent px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition hover:border-accent-hover hover:bg-accent-hover"
      >
        + New Project
      </button>
      {open ? (
        <ProjectFormModal
          onCancel={() => setOpen(false)}
          onSaved={(project) => {
            setOpen(false);
            router.push(`/projects/${encodeURIComponent(project.key)}`);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
