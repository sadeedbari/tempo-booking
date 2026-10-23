import { test, expect, type Page } from "@playwright/test";
import { MAX_EXTRA_LOCATIONS, MAX_STAFF_PACKS } from "../../src/lib/billing";
import { login } from "./helpers";

// The refreshed public landing page (src/app/page.tsx and src/components/marketing/*).
// Signed-out checks need no login or data: they only read the page. The signed-in check uses the harness login.

const WIDTHS = [320, 375, 390, 768, 1024, 1280];
const TRIAL = "14-day free trial. No credit card required.";

async function open(page: Page, width = 1280, theme?: "light" | "dark") {
  await page.setViewportSize({ width, height: width < 700 ? 800 : 900 });
  if (theme) await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const num = async (page: Page, id: string) => Number(await page.getByTestId(id).innerText());

test.describe("landing page content", () => {
  test("landmarks, one h1, ordered headings and every section are present", async ({ page }) => {
    await open(page);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Booking, made effortless.");
    for (const name of ["Everything you need to run your day.", "Simple pricing in Canadian dollars.", "Questions, answered.", "Ready for calmer bookings?"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // Four big benefits, then one compact list for everything else (with its two sub-headings).
    for (const name of ["Online booking for appointments", "Class booking with a waitlist", "Deposits and reminders", "A booking page for your website", "And everything else"]) {
      await expect(page.getByRole("heading", { level: 3, name })).toBeVisible();
    }
    for (const name of ["Grow your team", "Run the business"]) {
      await expect(page.getByRole("heading", { level: 4, name })).toBeVisible();
    }
    // Heading levels never skip downwards (h1 -> h2 -> h3 -> h4).
    const levels = await page.locator("h1,h2,h3,h4,h5,h6").evaluateAll((els) => els.map((e) => Number(e.tagName[1])));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading order at index ${i}`).toBeLessThanOrEqual(1);
    await expect(page.locator("#features")).toBeVisible();
    await expect(page.locator("#pricing")).toBeVisible();
    await expect(page.locator("#faq")).toBeVisible();
    // Feature coverage spot checks across all groups: each is named exactly once, as a bold lead-in.
    for (const t of ["A calendar you'll enjoy", "Automatic waitlist", "Staff without a login", "Deposits with Stripe", "Website contact form", "Install on your phone", "Calendar sync", "Excel export"]) {
      await expect(page.locator("#features").getByText(`${t}.`, { exact: true })).toHaveCount(1);
    }
    await expect(page.locator("#faq details")).toHaveCount(8);
    await expect(page.getByText("not a medical records system")).toHaveCount(1);
  });

  test("primary CTA, trial line, secondary CTA and legal links", async ({ page }) => {
    await open(page);
    const hero = page.locator("section[aria-labelledby=hero-title]");
    const cta = hero.getByRole("link", { name: "Get started free", exact: true });
    await expect(cta).toHaveAttribute("href", "/signup");
    await expect(hero.getByText(TRIAL, { exact: true })).toBeVisible();
    await expect(hero.getByRole("link", { name: "See what's inside" })).toHaveAttribute("href", "#features");
    // Pricing repeats the CTA and the trial line, with the tax wording.
    const pricing = page.locator("#pricing");
    await expect(pricing.getByRole("link", { name: "Get started free", exact: true })).toHaveAttribute("href", "/signup");
    await expect(pricing.getByTestId("pricing-trial-line")).toHaveText(TRIAL);
    await expect(pricing.getByText("Prices in CAD, plus applicable taxes where required.")).toBeVisible();
    await expect(pricing.getByText("$15", { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText("+$15/month.", { exact: false }).first()).toBeVisible();
    await expect(pricing.getByText("+$5/month.", { exact: false }).first()).toBeVisible();
    // Header and footer links.
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Get started", exact: true })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "mailto:info@sulosystems.com");
    await expect(page.getByRole("switch", { name: "Dark mode" })).toBeVisible();
  });

  test("signed-in visitors see Open Tempo and Go to your calendar instead of sign-up buttons", async ({ page }) => {
    await login(page, "ownerA");
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Open Tempo", exact: true })).toHaveAttribute("href", "/app");
    await expect(page.getByRole("link", { name: "Go to your calendar" }).first()).toHaveAttribute("href", "/app");
    await expect(page.getByRole("link", { name: "Get started free" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Get started", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByText(TRIAL)).toHaveCount(0);
  });

  test("theme slider switches dark mode and remembers it", async ({ page }) => {
    await open(page, 1280, "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("switch", { name: "Dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("price estimator", () => {
  const set = async (page: Page, locations: number, packs: number) => {
    const addL = page.getByRole("button", { name: "Add one location" });
    const remL = page.getByRole("button", { name: "Remove one location" });
    const addP = page.getByRole("button", { name: "Add one extra staff pack" });
    const remP = page.getByRole("button", { name: "Remove one extra staff pack" });
    while ((await num(page, "locations-value")) < locations) await addL.click();
    while ((await num(page, "locations-value")) > locations) await remL.click();
    while ((await num(page, "packs-value")) < packs) await addP.click();
    while ((await num(page, "packs-value")) > packs) await remP.click();
  };

  test("starts at $15 and gives $30, $35 and $55 for the examples", async ({ page }) => {
    await open(page);
    const total = page.getByTestId("estimator-total");
    const summary = page.getByTestId("estimator-summary");
    await expect(total).toHaveText("$15");
    await expect(summary).toHaveText("1 location, 5 staff included");
    const cases: [number, number, string, number][] = [[2, 0, "$30", 10], [2, 1, "$35", 15], [3, 2, "$55", 25], [1, 0, "$15", 5]];
    for (const [l, p, price, staff] of cases) {
      await set(page, l, p);
      await expect(total, `${l} locations, ${p} packs`).toHaveText(price);
      await expect(summary).toContainText(`${staff} staff included`);
    }
    // The three quick examples set the same values.
    await page.getByRole("button", { name: "3 locations, 25 staff" }).click();
    await expect(total).toHaveText("$55");
    await page.getByRole("button", { name: "2 locations, 10 staff" }).click();
    await expect(total).toHaveText("$30");
    await page.getByRole("button", { name: "2 locations, 15 staff" }).click();
    await expect(total).toHaveText("$35");
  });

  test("steppers stop at their limits", async ({ page }) => {
    await open(page);
    const remL = page.getByRole("button", { name: "Remove one location" });
    const addL = page.getByRole("button", { name: "Add one location" });
    const remP = page.getByRole("button", { name: "Remove one extra staff pack" });
    const addP = page.getByRole("button", { name: "Add one extra staff pack" });
    await expect(remL).toHaveAttribute("aria-disabled", "true");
    await remL.click({ force: true }); // aria-disabled: Playwright would wait forever without force
    expect(await num(page, "locations-value")).toBe(1);
    await expect(remP).toHaveAttribute("aria-disabled", "true");
    await remP.click({ force: true });
    expect(await num(page, "packs-value")).toBe(0);
    for (let i = 0; i < MAX_EXTRA_LOCATIONS + 3; i++) await addL.click({ force: true });
    expect(await num(page, "locations-value")).toBe(1 + MAX_EXTRA_LOCATIONS);
    await expect(addL).toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < MAX_STAFF_PACKS + 3; i++) await addP.click({ force: true });
    expect(await num(page, "packs-value")).toBe(MAX_STAFF_PACKS);
    await expect(addP).toHaveAttribute("aria-disabled", "true");
    // 15 + 20 x 15 + 40 x 5 = 515
    await expect(page.getByTestId("estimator-total")).toHaveText("$515");
  });

  test("works by keyboard and announces the total in a polite live region", async ({ page }) => {
    await open(page);
    const live = page.locator("[aria-live=polite]").filter({ has: page.getByTestId("estimator-total") });
    await expect(live).toHaveCount(1);
    await expect(live).toHaveAttribute("aria-atomic", "true");
    await page.getByRole("group", { name: "Locations" }).waitFor();
    const addL = page.getByRole("button", { name: "Add one location" });
    await addL.focus();
    await page.keyboard.press("Enter");
    await expect(live).toContainText("$30");
    await page.keyboard.press("Space");
    await expect(live).toContainText("$45");
    // Tab order: remove, add (locations), then remove, add (packs).
    await page.getByRole("button", { name: "Remove one location" }).focus();
    await page.keyboard.press("Tab");
    await expect(addL).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Remove one extra staff pack" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Add one extra staff pack" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(live).toContainText("$50");
    // Focus stays on the button when a limit is reached (aria-disabled, not disabled).
    await expect(page.getByRole("group", { name: "Extra staff packs" })).toBeVisible();
  });
});

test.describe("responsive layout", () => {
  for (const width of WIDTHS) {
    test(`no horizontal scroll and nothing wider than the screen at ${width}px`, async ({ page }) => {
      await open(page, width);
      // Let the entry animations finish so positions are final.
      await page.waitForTimeout(700);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const wide: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          if (el.closest("[data-decor]") || el.closest(".sr-only")) continue;
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.right > vw + 1 || b.left < -1) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(b.left)}..${Math.round(b.right)}`);
        }
        return { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, wide: wide.slice(0, 8) };
      });
      expect(r.scrollW, "documentElement.scrollWidth").toBeLessThanOrEqual(r.vw);
      expect(r.bodyScrollW, "body.scrollWidth").toBeLessThanOrEqual(r.vw);
      expect(r.wide).toEqual([]);
      // The headline fits without overflowing its container.
      const h1 = await page.getByRole("heading", { level: 1 }).evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
      expect(h1.sw).toBeLessThanOrEqual(h1.cw + 1);
    });
  }

  test("header fits at 320px: logo, theme slider and Get started on one row, links below", async ({ page }) => {
    await open(page, 320);
    const header = page.locator("header");
    const hb = (await header.boundingBox())!;
    expect(hb.height).toBeLessThanOrEqual(58);
    for (const loc of [header.getByRole("link", { name: "Tempo home" }), header.getByRole("switch", { name: "Dark mode" }), header.getByRole("link", { name: "Get started", exact: true })]) {
      await expect(loc).toBeVisible();
      const b = (await loc.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(320);
      expect(b.y + b.height).toBeLessThanOrEqual(hb.height + 1);
    }
    const sections = page.getByRole("navigation", { name: "Page sections" });
    for (const n of ["Features", "Pricing", "FAQ", "Sign in"]) await expect(sections.getByRole("link", { name: n, exact: true })).toBeVisible();
    // Neighbours do not overlap.
    const boxes = await Promise.all([header.getByRole("link", { name: "Tempo home" }), header.getByRole("switch"), header.getByRole("link", { name: "Get started", exact: true })].map((l) => l.boundingBox()));
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
  });

  // D-034: the header is sticky only from 768px up; on phones it scrolls away (it ate 25-42% of the screen at 200% text).
  test("header is sticky from tablet width up and scrolls away on phones", async ({ page }) => {
    await open(page, 1280);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(200);
    expect(Math.round((await page.locator("header").boundingBox())!.y)).toBe(0);
    await open(page, 375);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(200);
    expect((await page.locator("header").boundingBox())!.y).toBeLessThan(0);
  });

  test("on phones the preview drops the sidebar and keeps the calendar", async ({ page }) => {
    await open(page, 375);
    await expect(page.getByRole("img", { name: /Illustration of the Tempo calendar/ })).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByText("Tuesday, 14")).toBeVisible();
  });

  test("each benefit's picture sits under its text on phones and beside it on desktop, and the extras list goes from one column to two", async ({ page }) => {
    await open(page, 375);
    const layout = () => page.evaluate(() => {
      const b = document.querySelector("[data-benefit=book]")!;
      const t = b.children[0].getBoundingClientRect();
      const p = b.children[1].getBoundingClientRect();
      const team = document.getElementById("group-team")!.getBoundingClientRect();
      const run = document.getElementById("group-run")!.getBoundingClientRect();
      return { beside: p.left >= t.right - 1, below: p.top >= t.bottom - 1, extrasTwoColumns: Math.abs(team.left - run.left) > 40, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    const phone = await layout();
    expect(phone).toMatchObject({ beside: false, below: true, extrasTwoColumns: false });
    expect(phone.overflow).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await layout()).toMatchObject({ beside: true, extrasTwoColumns: true });
  });

  test("each benefit has one described picture and no images to load", async ({ page }) => {
    await open(page);
    const pictures = page.locator("#features [data-benefit] > [role=img]");
    await expect(pictures).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(pictures.nth(i)).toHaveAttribute("aria-label", /^Illustration of /);
    await expect(page.locator("#features img")).toHaveCount(0);
  });

  for (const width of [375, 1280]) {
    test(`tap targets are at least 44x44 in header, hero, estimator and footer at ${width}px`, async ({ page }) => {
      await open(page, width);
      await page.waitForTimeout(700);
      const small = await page.evaluate(() => {
        const scopes = ["header", "nav[aria-label='Page sections']", "section[aria-labelledby=hero-title]", "#pricing", "footer"];
        const out: string[] = [];
        for (const s of scopes) {
          for (const el of Array.from(document.querySelectorAll(`${s} a, ${s} button, ${s} summary`))) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue; // not displayed at this width
            if (b.width < 43.5 || b.height < 43.5) out.push(`${s}: ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} ${Math.round(b.width)}x${Math.round(b.height)}`);
          }
        }
        return out;
      });
      expect(small).toEqual([]);
    });
  }

  test("body text is at least 16px (illustration excluded)", async ({ page }) => {
    await open(page, 375);
    const tiny = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("main p, main li, main summary, main a, main button, footer p, footer a, header a"))) {
        if (el.closest("[role=img]")) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 16) out.push(`${el.tagName} ${px}px ${(el.textContent || "").slice(0, 30)}`);
      }
      return out;
    });
    expect(tiny).toEqual([]);
  });

  test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const d = await page.locator(".animate-rise").first().evaluate((e) => parseFloat(getComputedStyle(e).animationDuration));
    expect(d).toBeLessThan(0.01);
  });
});

test.describe("navigation and FAQ", () => {
  for (const width of [375, 1280]) {
    test(`anchor links land below the sticky header at ${width}px`, async ({ page }) => {
      await open(page, width);
      for (const [name, heading] of [["Features", "features-title"], ["Pricing", "pricing-title"], ["FAQ", "faq-title"]] as const) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole("link", { name, exact: true }).click();
        await expect.poll(async () => page.evaluate(() => window.scrollY), { message: `${name} scrolled` }).toBeGreaterThan(100);
        await page.waitForTimeout(300);
        const hb = (await page.locator("header").boundingBox())!;
        const t = (await page.locator(`#${heading}`).boundingBox())!;
        expect(t.y, `${name} heading below the header`).toBeGreaterThanOrEqual(hb.y + hb.height - 1);
        expect(t.y).toBeLessThan(400);
      }
    });
  }

  test("skip link moves focus to main content", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("FAQ opens and closes by keyboard", async ({ page }) => {
    await open(page, 375);
    const first = page.locator("#faq summary").first();
    const details = page.locator("#faq details").first();
    await first.focus();
    await expect(details).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details.getByText(/14 days from the day you create your team/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
    await page.keyboard.press("Space");
    await expect(details).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(page.locator("#faq summary").nth(1)).toBeFocused();
  });
});

test.describe("contrast in light and dark", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`key text meets 4.5:1 in ${theme} mode`, async ({ page }) => {
      await open(page, 1280, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.locator("#faq summary").first().click();
      await page.waitForTimeout(700);
      const results = await page.evaluate(() => {
        const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        // Any CSS colour string -> [r,g,b,a] by letting the canvas parse it.
        const rgba = (c: string): [number, number, number, number] => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = "#000";
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3] / 255];
        };
        const over = (top: number[], bottom: number[]) => {
          const a = top[3];
          return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat([1]);
        };
        const bgOf = (el: Element) => {
          const chain: number[][] = [];
          for (let e: Element | null = el; e; e = e.parentElement) {
            chain.push(rgba(getComputedStyle(e).backgroundColor));
          }
          let acc: number[] = rgba(getComputedStyle(document.body).backgroundColor);
          if (acc[3] < 1) acc = [255, 255, 255, 1];
          for (const c of chain.reverse()) if (c[3] > 0) acc = over(c, acc);
          return acc;
        };
        const lum = (c: number[]) => {
          const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const ratio = (el: Element) => {
          const bg = bgOf(el);
          const fg = over(rgba(getComputedStyle(el).color), bg);
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        };
        const q = (s: string) => document.querySelector(s)!;
        const targets: Record<string, Element> = {
          eyebrow: q("section[aria-labelledby=hero-title] > p"),
          subhead: q("section[aria-labelledby=hero-title] > p:nth-of-type(2)"),
          trialLine: q("section[aria-labelledby=hero-title] > p:nth-of-type(3)"),
          primaryCta: q("section[aria-labelledby=hero-title] a[href='/signup']"),
          headerCta: q("header a[href='/signup']"),
          featureBody: q("#features li p"),
          pricingSubhead: q("#pricing-title + p"),
          planTrialLine: q("[data-testid=pricing-trial-line]"),
          estimatorSummary: q("[data-testid=estimator-summary]"),
          estimatorTotal: q("[data-testid=estimator-total]"),
          estimatorHint: q("[aria-labelledby=locations-label] > div > div:nth-child(2)"),
          faqQuestion: q("#faq summary"),
          faqAnswer: q("#faq details[open] p"),
          footerLink: q("footer a"),
          footerText: q("footer p"),
        };
        return Object.entries(targets).map(([k, el]) => [k, Math.round(ratio(el) * 100) / 100] as const);
      });
      for (const [name, r] of results) expect(r, `${name} contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("search and sharing metadata", () => {
  test("title, description, canonical, Open Graph and Twitter tags", async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle("Tempo: Online Booking Software for Service Businesses");
    const meta = (sel: string) => page.locator(sel).getAttribute("content");
    expect(await meta("meta[name=description]")).toMatch(/Online booking, group classes, reminders and deposits.*\$15 CAD\/month.*14-day free trial/);
    // the origin with or without the trailing slash is the same URL (Next writes it without)
    expect(await page.locator("link[rel=canonical]").getAttribute("href")).toMatch(/^https:\/\/tempo\.sulosystems\.com\/?$/);
    expect(await meta("meta[property='og:title']")).toContain("online booking");
    expect(await meta("meta[property='og:description']")).toContain("14-day free trial");
    expect(await meta("meta[property='og:url']")).toMatch(/^https:\/\/tempo\.sulosystems\.com\/?$/);
    expect(await meta("meta[name='twitter:card']")).toBeTruthy();
    expect(await meta("meta[name='twitter:title']")).toBeTruthy();
  });

  test("JSON-LD parses and states the $15 CAD monthly offer", async ({ page }) => {
    await open(page);
    const raw = await page.locator("script[type='application/ld+json']").first().textContent();
    expect(raw).not.toContain("<");
    const data = JSON.parse(raw!);
    const graph = data["@graph"] as Record<string, any>[];
    const app = graph.find((n) => n["@type"] === "SoftwareApplication")!;
    const org = graph.find((n) => n["@type"] === "Organization")!;
    expect(org.name).toBe("Sulo Systems");
    expect(String(app.offers.price)).toBe("15");
    expect(app.offers.priceCurrency).toBe("CAD");
    expect(app.offers.priceSpecification.unitCode).toBe("MON");
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|"review"/);
  });

  test("robots.txt and sitemap.xml list the public pages", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Sitemap: https://tempo.sulosystems.com/sitemap.xml");
    expect(robots).toMatch(/Allow: \//);
    const sm = await (await request.get("/sitemap.xml")).text();
    // SEO-004: /login and /signup are noindex now and no longer listed (spec encoded the old behaviour)
    for (const p of ["/", "/privacy", "/terms"]) expect(sm).toContain(`<loc>https://tempo.sulosystems.com${p}</loc>`);
    for (const p of ["/login", "/signup"]) expect(sm).not.toContain(`${p}</loc>`);
  });
});
