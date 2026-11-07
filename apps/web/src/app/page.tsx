import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-cyan-400">
            ARGUS
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-50">
            QA capture and bug tracking
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-400">
            Capture screenshots, annotations and voice notes in the browser,
            then triage them on the Kanban board with a developer-to-QA
            reconsider loop.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-md bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            Open dashboard
          </Link>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
          <p className="font-medium text-slate-300">Local services</p>
          <ul className="mt-2 space-y-1">
            <li>Web app, canvas and dashboard: this site (:13130)</li>
            <li>Asset storage (CDN): 127.0.0.1:18130</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Not signed in? The dashboard link will take you to the sign-in
            page first.
          </p>
        </div>

        <p className="text-xs text-slate-600">
          ARGUS QA capture and bug tracking ecosystem
        </p>
      </div>
    </main>
  );
}
