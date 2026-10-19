import { test } from "node:test";
import assert from "node:assert/strict";
import { ROBOTS_DISALLOW, buildBookingMetadata, clip } from "../src/lib/seo";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { buildJsonLd } from "../src/components/marketing/json-ld";
import { RESERVED_SLUGS } from "../src/lib/utils";
import { SITE_URL } from "../src/lib/site";
import type { PublicOrg } from "../src/lib/types";

/** robots.txt matching as Google documents it: prefix match, "*" = any characters, trailing "$" = end of the URL. */
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const esc = (p: string) => p.replace(/[.+?^(){}|[\]\\]/g, "\\$&");
  const body = (anchored ? rule.slice(0, -1) : rule).split("*").map(esc).join(".*");
  return new RegExp("^" + body + (anchored ? "$" : "")).test(path);
}
const blocked = (path: string) => ROBOTS_DISALLOW.some((r) => ruleMatches(r, path));

test("robots: app routes are blocked, including their sub-paths", () => {
  for (const p of ["/app", "/app/", "/app/settings", "/o/acme/schedule", "/api/stripe/webhook", "/auth/callback", "/onboarding", "/onboarding/x", "/booking/abc", "/invite/t", "/waitlist/t", "/preview", "/preview/x"]) {
    assert.ok(blocked(p), `${p} should be blocked`);
  }
});

test("robots: business slugs that merely start with a blocked word stay crawlable", () => {
  for (const p of ["/apple-nails", "/appointments-by-jo", "/preview-studio", "/onboarding-x", "/organic-spa", "/booking-room", "/api-fitness", "/author", "/embed/acme", "/acme", "/", "/privacy", "/login", "/signup"]) {
    assert.ok(!blocked(p), `${p} must not be blocked`);
  }
});

test("robots.ts output: one rule set, sitemap on the production origin", () => {
  const r = robots();
  assert.equal(r.sitemap, `${SITE_URL}/sitemap.xml`);
  const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  assert.equal(rules.allow, "/");
  assert.deepEqual(rules.disallow, ROBOTS_DISALLOW);
});

test("sitemap: production URLs only, no auth pages, fixed lastModified", () => {
  const s = sitemap();
  assert.deepEqual(s.map((e) => e.url), [`${SITE_URL}/`, `${SITE_URL}/privacy`, `${SITE_URL}/terms`]);
  for (const e of s) {
    assert.ok(e.url.startsWith("https://tempo.sulosystems.com"));
    assert.match(String(e.lastModified), /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("reserved slugs cover the static routes", () => {
  for (const s of ["forgot", "reset", "login", "signup", "embed", "preview"]) assert.ok(RESERVED_SLUGS.has(s), s);
});

const org = (over: Partial<PublicOrg["org"]> = {}, services = 1): PublicOrg => ({
  org: { id: "1", name: "Lumen Studio", slug: "lumen", description: "Hair & skin in Toronto.", logo_url: null, ...over } as PublicOrg["org"],
  services: Array.from({ length: services }, (_, i) => ({ id: String(i) }) as PublicOrg["services"][number]),
  staff: [], locations: [], availability: [],
});

test("booking page metadata: active business is indexable with canonical and social tags", () => {
  const m = buildBookingMetadata(org(), true);
  assert.equal(m.title, "Book with Lumen Studio");
  assert.equal(m.description, "Hair & skin in Toronto.");
  assert.equal(m.alternates?.canonical, "/lumen");
  assert.deepEqual(m.robots, { index: true, follow: true });
  assert.equal((m.openGraph as { url: string }).url, "/lumen");
  assert.equal((m.twitter as { card: string }).card, "summary_large_image");
  // No logo: the default share image is set explicitly (a page-level openGraph replaces the root one) (D-030).
  assert.equal((m.openGraph as { images: { url: string }[] }).images[0].url, "https://tempo.sulosystems.com/opengraph-image.png");
  assert.deepEqual((m.twitter as { images: unknown }).images, ["https://tempo.sulosystems.com/twitter-image.png"]);
});

test("booking page metadata: paused, empty and unknown businesses are noindex", () => {
  assert.deepEqual(buildBookingMetadata(org(), false).robots, { index: false, follow: false });
  assert.deepEqual(buildBookingMetadata(org({}, 0), true).robots, { index: false, follow: false });
  assert.deepEqual(buildBookingMetadata(null, null).robots, { index: false, follow: false });
  // Unknown entitlement answer behaves like the page itself (it shows the booking flow).
  assert.deepEqual(buildBookingMetadata(org(), null).robots, { index: true, follow: true });
});

test("booking page metadata: logo is used only when it is a web URL; long and missing descriptions are handled", () => {
  const withLogo = buildBookingMetadata(org({ logo_url: "https://x.supabase.co/logo.png" }), true);
  assert.deepEqual((withLogo.openGraph as { images: unknown }).images, [{ url: "https://x.supabase.co/logo.png" }]);
  assert.equal((withLogo.twitter as { card: string }).card, "summary");
  const bad = buildBookingMetadata(org({ logo_url: "javascript:alert(1)" }), true);
  assert.equal((bad.openGraph as { images: { url: string }[] }).images[0].url, "https://tempo.sulosystems.com/opengraph-image.png");
  assert.equal(buildBookingMetadata(org({ description: null }), true).description, "Book an appointment with Lumen Studio online.");
  assert.ok(String(buildBookingMetadata(org({ description: "word ".repeat(100) }), true).description).length <= 160);
  assert.equal(clip("  a   b \n c "), "a b c");
});

test("json-ld: organization, website and software nodes, and no ratings", () => {
  const g = buildJsonLd()["@graph"] as Record<string, unknown>[];
  const types = g.map((n) => n["@type"]);
  assert.deepEqual(types, ["Organization", "WebSite", "SoftwareApplication"]);
  const text = JSON.stringify(g);
  assert.equal(g[0].url, SITE_URL);
  assert.equal(g[0].logo, `${SITE_URL}/icons/icon-512.png`);
  assert.equal(g[1].url, SITE_URL);
  assert.ok(!/aggregateRating|"review"|FAQPage|SearchAction/.test(text));
  assert.match(text, /1 location and 5 staff/);
  assert.match(text, /"price":"15"/);
});
