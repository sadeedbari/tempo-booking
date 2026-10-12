"use client";

/** Last-resort screen if the page frame itself fails. It has to bring its own styling. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#f5f5f7", color: "#1d1d1f", textAlign: "center", padding: 24 }}>
        <div role="alert">
          <title>Something went wrong</title>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#6e6e73", margin: "0 0 20px" }}>Please try again. Your information is safe.</p>
          {error.digest && <p style={{ color: "#86868b", fontSize: 12 }}>Reference: {error.digest}</p>}
          <button onClick={() => retry()} style={{ font: "600 16px system-ui", padding: "12px 22px", border: 0, borderRadius: 12, background: "#007aff", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
