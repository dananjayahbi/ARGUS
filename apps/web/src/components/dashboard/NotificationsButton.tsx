"use client";

import { useCallback, useEffect, useState } from "react";

import { IssueDetailModal } from "./IssueDetailModal";

interface NotificationItem {
  id: string;
  issue_id: string;
  comment_id: string | null;
  actor_role: "developer" | "qa";
  actor_email: string | null;
  read_at: string | null;
  created_at: string;
  issue_number: number;
  issue_title: string;
  project_key: string;
  project_name: string;
  comment_body: string | null;
  comment_author_role: "developer" | "qa" | null;
}

const POLL_INTERVAL_MS = 30_000;

const ROLE_LABEL: Record<"developer" | "qa", string> = {
  developer: "Developer",
  qa: "QA",
};

function excerpt(value: string | null): string {
  if (!value) {
    return "Attachment-only comment";
  }
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 180
    ? `${singleLine.slice(0, 180)}…`
    : singleLine;
}

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [detail, setDetail] = useState<{
    issueId: string;
    commentId: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      const payload = (await response.json().catch(() => null)) as
        | {
            notifications?: NotificationItem[];
            unread_count?: number;
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.notifications) {
        setError(
          payload?.error?.message ?? "Unable to load notifications.",
        );
        return;
      }

      setError(null);
      setNotifications(payload.notifications);
      setUnreadCount(payload.unread_count ?? 0);
      setHasLoaded(true);
    } catch {
      setError("Unable to reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      void refresh();
    }, 0);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    function handleRefresh() {
      void refresh();
    }

    window.addEventListener("argus:notifications-changed", handleRefresh);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
      window.removeEventListener("argus:notifications-changed", handleRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const kickoff = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(kickoff);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !detail) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", handleKey);
    };
  }, [detail, open]);

  async function markRead(ids: string[]) {
    setNotifications((current) =>
      current.map((item) =>
        ids.includes(item.id) && !item.read_at
          ? { ...item, read_at: new Date().toISOString() }
          : item,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - ids.length));

    try {
      const response = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const payload = (await response.json().catch(() => null)) as {
        unread_count?: number;
      } | null;
      if (response.ok && typeof payload?.unread_count === "number") {
        setUnreadCount(payload.unread_count);
      }
    } catch {
      // The local badge is already optimistic; the next poll reconciles it.
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) =>
        item.read_at ? item : { ...item, read_at: now },
      ),
    );
    setUnreadCount(0);

    try {
      const response = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const payload = (await response.json().catch(() => null)) as {
        unread_count?: number;
      } | null;
      if (response.ok && typeof payload?.unread_count === "number") {
        setUnreadCount(payload.unread_count);
      }
      await refresh();
    } catch {
      setError("Unable to mark notifications as read.");
    } finally {
      setMarkingAll(false);
    }
  }

  function openNotification(item: NotificationItem) {
    setDetail({ issueId: item.issue_id, commentId: item.comment_id });
    if (!item.read_at) {
      void markRead([item.id]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label="Notifications"
        className="relative rounded-lg border border-cream/30 px-3 py-1.5 text-xs font-semibold text-cream transition hover:bg-cream/10"
      >
        <span className="flex items-center gap-1.5">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          Notifications
        </span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-[18px] text-ink">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          className="fixed inset-0 z-40 flex flex-col bg-cream"
        >
          <header className="shrink-0 border-b border-teal-hover bg-teal px-6 py-4 text-cream">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
                  Notifications
                </p>
                <h2 className="mt-1 text-xl font-semibold text-cream">
                  Comment activity
                </h2>
                <p className="mt-1 text-xs text-teal-tint">
                  {unreadCount > 0
                    ? `${unreadCount} unread`
                    : hasLoaded
                      ? "You're all caught up."
                      : "Loading activity…"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={markingAll || unreadCount === 0}
                  className="rounded-lg border border-cream/30 px-3 py-1.5 text-xs font-semibold text-cream transition hover:bg-cream/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {markingAll ? "Marking…" : "Mark all read"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-cream/30 px-3 py-1.5 text-xs font-semibold text-cream transition hover:bg-cream/10"
                >
                  Close
                </button>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl space-y-3 p-6">
              {error ? (
                <div className="rounded-md border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
                  <p>{error}</p>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="mt-2 rounded border border-bad/40 px-2 py-1 text-xs font-semibold"
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {loading && notifications.length === 0 ? (
                <p className="text-sm text-muted">Loading notifications…</p>
              ) : null}

              {!loading && !error && notifications.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-paper/60 p-8 text-center">
                  <p className="text-sm font-medium text-ink-soft">
                    No notifications yet
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    When the other person comments on an issue, it appears
                    here.
                  </p>
                </div>
              ) : null}

              {notifications.length > 0 ? (
                <ol className="space-y-2">
                  {notifications.map((item) => {
                    const unread = !item.read_at;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => openNotification(item)}
                          className={`w-full rounded-xl border p-4 text-left shadow-sm transition hover:border-accent ${
                            unread
                              ? "border-accent/60 bg-paper"
                              : "border-line bg-paper/60"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {unread ? (
                                <span
                                  aria-label="Unread"
                                  className="h-2 w-2 shrink-0 rounded-full bg-accent"
                                />
                              ) : (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-line-strong" />
                              )}
                              <span className="text-xs font-semibold text-ink-soft">
                                {ROLE_LABEL[item.actor_role]} commented
                              </span>
                              <span className="rounded border border-line-strong bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                                {item.project_key}-{item.issue_number}
                              </span>
                            </div>
                            <time className="text-[11px] text-muted">
                              {new Date(item.created_at).toLocaleString()}
                            </time>
                          </div>

                          <p className="mt-2 truncate text-sm font-medium text-ink">
                            {item.issue_title}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                            {excerpt(item.comment_body)}
                          </p>

                          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-teal">
                            Open issue
                            <span aria-hidden="true">→</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {detail ? (
        <IssueDetailModal
          issueId={detail.issueId}
          focusCommentId={detail.commentId}
          onClose={() => setDetail(null)}
          onDeleted={() => {
            setDetail(null);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}
