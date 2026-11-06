"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#020617",
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "2rem",
          }}
        >
          <div style={{ maxWidth: "32rem" }}>
            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "#22d3ee",
              }}
            >
              ARGUS
            </p>
            <h1 style={{ margin: "0.75rem 0", fontSize: "1.5rem" }}>
              Application error
            </h1>
            <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.6 }}>
              The root layout failed to render. Retry the request.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "1.25rem",
                border: 0,
                borderRadius: "0.375rem",
                background: "#06b6d4",
                color: "#020617",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
