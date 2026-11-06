"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        setError(body?.error?.message ?? "Unable to sign in.");
        return;
      }

      const destination = next.startsWith("/") ? next : "/dashboard";
      window.location.assign(destination);
    } catch {
      setError("Unable to reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
    >
      <label className="block space-y-1 text-xs text-slate-400">
        <span>Email</span>
        <input
          type="email"
          autoFocus
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="block space-y-1 text-xs text-slate-400">
        <span>Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </label>

      {error ? (
        <p className="text-xs leading-5 text-rose-300">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
