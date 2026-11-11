"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-md border border-line-strong bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-teal";

export function LoginForm({ next }: { next: string }) {
  const [identifier, setIdentifier] = useState("");
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
        body: JSON.stringify({ username: identifier, password }),
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
      className="space-y-4 rounded-2xl border border-line bg-paper p-6 shadow-[0_22px_54px_rgba(23,49,58,0.10)]"
    >
      <label className="block space-y-1 text-xs text-muted">
        <span>Username or email</span>
        <input
          type="text"
          autoFocus
          required
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className={inputClass}
        />
      </label>

      <label className="block space-y-1 text-xs text-muted">
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
        <p className="text-xs leading-5 text-bad">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-teal px-4 py-2 text-sm font-semibold text-cream transition hover:bg-teal-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
