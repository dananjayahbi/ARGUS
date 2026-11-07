"use client";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-lg space-y-4">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent-strong">
          ARGUS
        </p>
        <h1 className="text-2xl font-semibold text-ink">
          Something went wrong
        </h1>
        <p className="text-sm leading-6 text-muted">
          The application hit an unexpected error. Retry the request, or return
          to the home page.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-cream transition hover:bg-teal-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
