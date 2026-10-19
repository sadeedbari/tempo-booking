import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import type { PublicOrg } from "@/lib/types";

/**
 * robots.txt Disallow rules. They are prefix matches, and business booking pages live at /<slug>, so a bare "/app"
 * would also hide /apple-nails. Each app route is therefore listed as an exact path ("$" = end of URL; Google and
 * Bing support it) plus its sub-paths ("/app/"). /embed/ is NOT listed on purpose: those pages send their own noindex,
 * and a crawler blocked by robots.txt never gets to read it.
 */
export const ROBOTS_DISALLOW = [
  "/app$", "/app/", "/o/", "/api/", "/auth/", "/onboarding$", "/onboarding/",
  "/booking/", "/invite/", "/waitlist/", "/preview$", "/preview/",
];

const MAX_DESCRIPTION = 160;

/** Collapses whitespace and cuts at a word boundary so search snippets and link cards stay tidy. */
export function clip(text: string, max = MAX_DESCRIPTION): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length).replace(/[,;:.\s]+$/, "") + "…";
}

/**
 * Metadata for a business's public booking page (/<slug>).
 * Indexable only when the business is accepting bookings and has something to book; otherwise noindex
 * (paused, trial over or empty pages would be thin content). Pure function so it is easy to test.
 * `accepts` is the org_accepts_bookings answer (null/undefined = unknown, treated as accepting like the page does).
 */
export function buildBookingMetadata(data: PublicOrg | null, accepts: boolean | null | undefined): Metadata {
  if (!data) return { title: "Not found", robots: { index: false, follow: false } };
  const { org } = data;
  const indexable = accepts !== false && data.services.length > 0;
  const title = `Book with ${org.name}`;
  const description = clip(org.description?.trim() || `Book an appointment with ${org.name} online.`);
  const path = `/${org.slug}`;
  // Only use the business logo as the share picture if it is a real web URL; otherwise the site-wide default image applies.
  const logo = org.logo_url && /^https?:\/\//i.test(org.logo_url) ? org.logo_url : null;
  // A page-level openGraph/twitter REPLACES the root layout's, so the site default share image (the file-based
  // opengraph-image / twitter-image) is not inherited: set it explicitly with absolute URLs (D-030).
  const ogImages = logo ? [{ url: logo }] : [{ url: `${SITE_URL}/opengraph-image.png`, width: 1200, height: 630, alt: `${SITE_NAME}: online booking` }];
  const twImages = logo ? [logo] : [`${SITE_URL}/twitter-image.png`];
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", url: path, siteName: SITE_NAME, locale: "en_CA", title: `${title} · ${SITE_NAME}`, description, images: ogImages },
    twitter: { card: logo ? "summary" : "summary_large_image", title: `${title} · ${SITE_NAME}`, description, images: twImages },
  };
}
