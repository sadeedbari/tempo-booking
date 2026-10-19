// SEO: robots.txt, sitemap.xml, noindex on auth pages, landing metadata, share image, JSON-LD, and the indexing rules
// of a business's public booking page (indexable with canonical when active, noindex when paused, /embed always noindex).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S } from "./helpers";
import { A, restoreSeedPlans, setPlan } from "./billing-helpers";

const ORIGIN = "https://tempo.sulosystems.com"; // SITE_URL in src/lib/site.ts is a fixed production origin on purpose
// returns null at once when the tag is absent (locator.getAttribute would wait for it until the test timeout)
const meta = async (page: Page, sel: string) => (await page.locator(sel).count()) ? page.locator(sel).first().getAttribute("content") : null;
/** The og:image URL points at the production host; fetch the same path from the server under test. */
const local = (u: string) => { const x = new URL(u); return x.pathname + x.search; };

test.describe("robots.txt and sitemap.xml", () => {
  test("robots.txt has anchored rules, allows booking slugs, and points at the production sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const txt = await res.text();
    expect(txt).toContain("User-Agent: *");
    expect(txt).toContain("Allow: /");
    for (const r of ["/app$", "/app/", "/o/", "/api/", "/auth/", "/onboarding$", "/onboarding/", "/booking/", "/invite/", "/waitlist/", "/preview$", "/preview/"]) {
      expect(txt).toContain(`Disallow: ${r}\n`);
    }
    // No bare prefix rules that would block slugs such as /apple-nails.
    expect(txt).not.toMatch(/^Disallow: \/(app|preview|onboarding)\s*$/m);
    expect(txt).not.toMatch(/Disallow: \/embed/);
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  test("sitemap.xml is XML with only production URLs and no login/signup", async ({ request }) => {
    const res = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("xml");
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`, `${ORIGIN}/privacy`, `${ORIGIN}/terms`]);
    expect(xml).not.toMatch(/localhost|vercel\.app|\/login|\/signup/);
    expect(xml.match(/<lastmod>/g)).toHaveLength(3);
  });

  test("llms.txt is served as plain text without a redirect", async ({ request }) => {
    const res = await request.get("/llms.txt", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("$15 CAD per month");
  });
});

test.describe("auth pages are noindex,follow", () => {
  for (const path of ["/login", "/signup", "/forgot", "/reset"]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      const robots = (await meta(page, 'meta[name="robots"]')) ?? "";
      expect(robots).toContain("noindex");
      expect(robots).toContain("follow");
      expect(robots).not.toContain("nofollow");
    });
  }
});

test.describe("landing page metadata", () => {
  test("title, description, canonical, language, Open Graph and Twitter tags", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Tempo: Online Booking Software for Service Businesses");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
    expect(await meta(page, 'meta[name="description"]')).toContain("From $15 CAD/month");
    // Next writes the root canonical without a trailing slash: the same URL
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/^https:\/\/tempo\.sulosystems\.com\/?$/);
    expect((await meta(page, 'meta[name="robots"]')) ?? "index").not.toContain("noindex");
    expect(await meta(page, 'meta[property="og:site_name"]')).toBe("Tempo");
    expect(await meta(page, 'meta[property="og:type"]')).toBe("website");
    expect(await meta(page, 'meta[property="og:url"]')).toMatch(/^https:\/\/tempo\.sulosystems\.com\/?$/);
    expect(await meta(page, 'meta[property="og:image:width"]')).toBe("1200");
    expect(await meta(page, 'meta[property="og:image:height"]')).toBe("630");
    expect(await meta(page, 'meta[property="og:image:alt"]')).toContain("Booking, made effortless.");
    expect(await meta(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(await meta(page, 'meta[name="twitter:image"]')).toMatch(/^https:\/\/tempo\.sulosystems\.com\/twitter-image\.png/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("the og:image and twitter:image resolve to a PNG under 300 KB at 1200x630", async ({ page, request }) => {
    await page.goto("/");
    for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const url = await meta(page, sel);
      expect(url, sel).toMatch(/^https:\/\/tempo\.sulosystems\.com\//);
      const res = await request.get(local(url!));
      expect(res.status(), sel).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
      const body = await res.body();
      expect(body.length, sel).toBeLessThan(300 * 1024);
      expect(body.readUInt32BE(16), "width").toBe(1200); // PNG IHDR: width at byte 16, height at 20
      expect(body.readUInt32BE(20), "height").toBe(630);
    }
  });

  test("JSON-LD parses; has Organization, WebSite and SoftwareApplication; no ratings, reviews or FAQ", async ({ page }) => {
    await page.goto("/");
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(raw).toHaveLength(1);
    const data = JSON.parse(raw[0]);
    const nodes = data["@graph"] as Record<string, unknown>[];
    expect(nodes.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    expect(nodes[0].logo).toBe(`${ORIGIN}/icons/icon-512.png`);
    expect(nodes[1].url).toBe(ORIGIN);
    expect(raw[0]).not.toMatch(/aggregateRating|"review"|FAQPage|SearchAction/);
    expect(JSON.stringify(nodes[2])).toContain('"price":"15"');
  });

  test("section headings carry the search phrases and the h1 is unchanged", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Booking, made effortless.");
    for (const name of ["Online booking for appointments", "Class booking with a waitlist", "Deposits and reminders", "A booking page for your website"]) {
      await expect(page.getByRole("heading", { level: 3, name })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 2, name: "Simple pricing in Canadian dollars." })).toBeVisible();
    await expect(page.getByText("booking system and scheduling tool")).toHaveCount(1);
  });
});

test.describe("public booking page indexing", () => {
  const slug = S.orgA.slug;
  test.afterAll(async () => { await restoreSeedPlans(); });

  test("an active business is indexable, with unique title, canonical, Open Graph and Twitter tags", async ({ page, request }) => {
    await setPlan(A(), "active", {});
    await page.goto(`/${slug}`);
    await expect(page).toHaveTitle(/^Book with .+ · Tempo$/);
    const robots = (await meta(page, 'meta[name="robots"]')) ?? "index";
    expect(robots).not.toContain("noindex");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${ORIGIN}/${slug}`);
    expect(await meta(page, 'meta[property="og:title"]')).toMatch(/^Book with .+ · Tempo$/);
    expect(await meta(page, 'meta[property="og:url"]')).toBe(`${ORIGIN}/${slug}`);
    expect(await meta(page, 'meta[name="description"]')).toBeTruthy();
    expect(await meta(page, 'meta[name="twitter:card"]')).toMatch(/summary/);
    // A business with no logo falls back to the default share image (and it resolves).
    expect(await page.locator('meta[property="og:image"]').count(), "D-029: summary_large_image card but no og:image on the booking page").toBeGreaterThan(0);
    const img = await meta(page, 'meta[property="og:image"]');
    if (img && img.startsWith(ORIGIN)) expect((await request.get(local(img))).status()).toBe(200);
  });

  test("a paused business is noindex", async ({ page }) => {
    await setPlan(A(), "trial-ended", {});
    await page.goto(`/${slug}`);
    expect(await meta(page, 'meta[name="robots"]')).toContain("noindex");
  });

  test("the embed pages are always noindex, active or not", async ({ page }) => {
    await setPlan(A(), "active", {});
    await page.goto(`/embed/${slug}`);
    expect(await meta(page, 'meta[name="robots"]')).toContain("noindex");
  });

  test("an unknown slug is a 404 and noindex", async ({ page }) => {
    const res = await page.goto("/no-such-business-xyz");
    expect(res?.status()).toBe(404);
    expect(await meta(page, 'meta[name="robots"]')).toContain("noindex");
  });
});
