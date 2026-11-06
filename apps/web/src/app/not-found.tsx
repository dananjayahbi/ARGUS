import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-lg space-y-4">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-cyan-400">
          404
        </p>
        <h1 className="text-2xl font-semibold text-slate-50">Page not found</h1>
        <p className="text-sm leading-6 text-slate-400">
          The page you requested does not exist.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
