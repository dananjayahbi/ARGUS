export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl space-y-4">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-cyan-400">
          ARGUS
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-50">
          QA capture and bug tracking
        </h1>
        <p className="text-base leading-7 text-slate-400">
          The foundation is running. Ingestion APIs, the tokenized canvas editor
          and the Kanban dashboard arrive in the next phases.
        </p>
      </div>
    </main>
  );
}
