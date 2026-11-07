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
        className="rounded-md bg-cyan-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400"
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
