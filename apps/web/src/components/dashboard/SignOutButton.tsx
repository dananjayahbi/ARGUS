"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
    >
      Sign out
    </button>
  );
}
