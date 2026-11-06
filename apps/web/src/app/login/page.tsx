import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-cyan-400">
            ARGUS
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-50">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Dashboard access for the QA and engineering team.
          </p>
        </div>

        <LoginForm next={next ?? "/dashboard"} />
      </div>
    </main>
  );
}
