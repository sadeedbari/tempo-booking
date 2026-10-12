/* Tempo service worker: makes the app installable and shows a friendly page when offline.
   It never caches pages or API responses, so signed-in data is always fresh and never stored. */
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;text-align:center;padding:24px">
<div><h1 style="font-size:22px;margin:0 0 8px">You're offline</h1><p style="color:#6e6e73;margin:0 0 20px">Tempo needs a connection to load your schedule.</p>
<button onclick="location.reload()" style="font:600 16px system-ui;padding:12px 22px;border:0;border-radius:12px;background:#007aff;color:#fff">Try again</button></div></body>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
