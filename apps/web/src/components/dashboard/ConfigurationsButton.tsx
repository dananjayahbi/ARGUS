"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface ExtensionConfig {
  appBaseUrl: string;
  cdnBaseUrl: string;
  workspaceToken: string;
  cdnToken: string;
  projects: Array<{ id: string; key: string; name: string }>;
}

const inputClass =
  "w-full min-w-0 flex-1 truncate rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100";

function ConfigRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-slate-400">{label}</label>
      <div className="flex items-center gap-2">
        <input readOnly value={value} className={inputClass} />
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function ConfigurationsButton({
  projects,
}: {
  projects: Array<{ id?: string; key: string; name: string }>;
}) {
  const pathname = usePathname();
  const currentKey = pathname.startsWith("/projects/")
    ? decodeURIComponent(pathname.split("/")[2] ?? "")
    : "";

  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ExtensionConfig | null>(null);
  const [manualKey, setManualKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const selectedKey = manualKey || currentKey || config?.projects[0]?.key || "";

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    fetch("/api/config/extension")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (ExtensionConfig & { error?: { message?: string } })
          | null;
        if (!response.ok || !body?.projects) {
          throw new Error(
            body?.error?.message ??
              "Unable to load extension configuration.",
          );
        }
        if (!cancelled) {
          setConfig(body);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load extension configuration.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function copyField(field: string, value: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("Clipboard unavailable");
      }
    } catch {
      return;
    }
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1500);
  }

  const projectOptions = config?.projects ?? projects;
  const activeProjectId =
    projectOptions.find((project) => project.key === selectedKey)?.id ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setCopiedField(null);
          setOpen(true);
        }}
        className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
      >
        ⚙ Configurations
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Extension configuration"
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
                  Configurations
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-50">
                  Extension settings
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Copy these into the ARGUS extension Settings (Chrome
                  extensions → ARGUS → Settings). Tokens stay in your browser
                  extension storage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            {error ? (
              <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                {error}
              </p>
            ) : null}

            {!config && !error ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : null}

            {config ? (
              <div className="space-y-4">
                <ConfigRow
                  label="App base URL"
                  value={config.appBaseUrl}
                  copied={copiedField === "app"}
                  onCopy={() => void copyField("app", config.appBaseUrl)}
                />
                <ConfigRow
                  label="CDN base URL"
                  value={config.cdnBaseUrl}
                  copied={copiedField === "cdn"}
                  onCopy={() => void copyField("cdn", config.cdnBaseUrl)}
                />
                <ConfigRow
                  label="Workspace ingestion token"
                  value={config.workspaceToken}
                  copied={copiedField === "workspace"}
                  onCopy={() =>
                    void copyField("workspace", config.workspaceToken)
                  }
                />
                <ConfigRow
                  label="CDN upload token"
                  value={config.cdnToken}
                  copied={copiedField === "cdnToken"}
                  onCopy={() => void copyField("cdnToken", config.cdnToken)}
                />

                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">
                    Project
                  </label>
                  <select
                    value={selectedKey}
                    onChange={(event) => setManualKey(event.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  >
                    <option value="">Select project…</option>
                    {projectOptions.map((project) => (
                      <option key={project.key} value={project.key}>
                        {project.name} ({project.key})
                      </option>
                    ))}
                  </select>
                </div>

                <ConfigRow
                  label="Project ID"
                  value={activeProjectId}
                  copied={copiedField === "projectId"}
                  onCopy={() => void copyField("projectId", activeProjectId)}
                />

                <p className="text-[11px] text-slate-500">
                  Paste each value into the matching extension field, then
                  click Save settings. Tokens are only shown to signed-in
                  dashboard users.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
