import Image from "next/image";

import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-8 text-ink">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <Image
            src="/argus-logo.png"
            alt="ARGUS"
            width={48}
            height={48}
            priority
            className="rounded-full shadow-md shadow-teal/20"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent-strong">
              ARGUS
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">Sign in</h1>
          </div>
        </div>
        <p className="text-sm text-muted">
          Dashboard access for the QA and engineering team.
        </p>

        <LoginForm next={next ?? "/dashboard"} />
      </div>
    </main>
  );
}
