import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-8 text-ink">
      <div className="w-full max-w-2xl space-y-8">
        <div className="flex items-center gap-4">
          <Image
            src="/argus-logo.png"
            alt="ARGUS"
            width={64}
            height={64}
            priority
            className="rounded-full shadow-lg shadow-teal/20"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent-strong">
              ARGUS · QA Capture
            </p>
            <h1 className="mt-1 text-4xl font-semibold tracking-tight text-ink">
              QA capture and bug tracking
            </h1>
          </div>
        </div>

        <p className="max-w-xl text-base leading-7 text-muted">
          Capture screenshots, annotations and voice notes in the browser, then
          triage them on the Kanban board with a developer-to-QA reconsider
          loop.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-cream shadow-md shadow-teal/20 transition hover:bg-teal-hover"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-line-strong bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-tint"
          >
            Open dashboard
          </Link>
        </div>

        <div className="rounded-2xl border border-line bg-paper p-5 text-sm text-ink-soft shadow-sm">
          <p className="font-semibold text-ink">Local services</p>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Web app, canvas and dashboard: this site (:13130)</li>
            <li>Asset storage (CDN): 127.0.0.1:18130</li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            Not signed in? The dashboard link will take you to the sign-in page
            first.
          </p>
        </div>

        <p className="text-xs text-muted">
          ARGUS QA capture and bug tracking ecosystem
        </p>
      </div>
    </main>
  );
}
