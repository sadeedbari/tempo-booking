import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

// Keep crawlers out of the signed-in app, API and per-customer links. Everything else (landing, legal, business booking pages) stays open.
// Rules are anchored so a business slug such as /apple-nails is not blocked (see src/lib/seo.ts).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
