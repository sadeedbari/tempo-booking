import type { NextConfig } from "next";

// Only the booking flow may be framed by other websites (the pop-up in public/embed.js).
// Everything else — the dashboard, sign-in, settings — can only be framed by Tempo itself,
// which stops click-jacking.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/((?!embed|booking|_next).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      {
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        source: "/booking/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/embed.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
