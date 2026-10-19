import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public marketing and legal pages only (login/signup are noindex, so they are not listed). lastModified uses FIXED
// dates, updated by hand when the page content changes: new Date() would change on every request and search engines
// then ignore the field. Business booking pages are not listed: the sitemap would need a database query plus the
// billing entitlement check for every business, which is not worth the risk for a cached public file.
// Dates: landing = refresh of 2026-10-19; privacy = date shown on that page (October 15, 2026); terms = src/lib/legal.ts.
const PAGES: { path: string; lastModified: string }[] = [
  { path: "/", lastModified: "2026-10-19" },
  { path: "/privacy", lastModified: "2026-10-15" },
  { path: "/terms", lastModified: "2026-10-12" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, lastModified }) => ({ url: `${SITE_URL}${path}`, lastModified }));
}
