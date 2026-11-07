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
      className="rounded-lg border border-cream/30 px-2 py-1.5 text-xs font-semibold text-cream transition hover:bg-cream/10"
    >
      Sign out
    </button>
  );
}
