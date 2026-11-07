import Link from "next/link";

const MESSAGES: Record<string, { title: string; body: string }> = {
  missing: {
    title: "Access token missing",
    body: "This canvas link is missing its access token. Open the link from the extension again.",
  },
  expired: {
    title: "Draft link expired",
    body: "Draft links are valid for 30 minutes. Create a new capture to get a fresh link.",
  },
  invalid_signature: {
    title: "Invalid draft link",
    body: "This canvas link is not valid for this draft.",
  },
  invalid_payload: {
    title: "Invalid draft link",
    body: "This canvas link is not valid for this draft.",
  },
  malformed: {
    title: "Invalid draft link",
    body: "This canvas link is not valid for this draft.",
  },
  wrong_issue: {
    title: "Invalid draft link",
    body: "This canvas link was issued for a different draft.",
  },
  not_found: {
    title: "Draft not found",
    body: "The draft no longer exists.",
  },
  already_submitted: {
    title: "Already submitted",
    body: "This issue has already been submitted and can no longer be edited here.",
  },
  unavailable: {
    title: "Canvas unavailable",
    body: "The draft could not be loaded. Try again shortly.",
  },
};

export function CanvasAccessDenied({ reason }: { reason: string }) {
  const message = MESSAGES[reason] ?? {
    title: "Access denied",
    body: "This canvas link cannot be used.",
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-8 text-ink">
      <div className="max-w-md space-y-4 rounded-xl border border-line bg-paper/60 p-8">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent-strong">
          ARGUS canvas
        </p>
        <h1 className="text-2xl font-semibold text-ink">{message.title}</h1>
        <p className="text-sm leading-6 text-muted">{message.body}</p>
        <Link
          href="/"
          className="inline-block rounded-md bg-teal px-4 py-2 text-sm font-medium text-cream transition hover:bg-teal-hover"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
