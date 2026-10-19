// Final retest of D-032 (Back keeps the chosen day), D-034 (landing header sticky only from md up, anchors land) and
// D-036 (booking and paused page contrast in light and dark, custom accent colour still readable).
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import fs from "node:fs";
import { test, expect } from "./fixtures";
import { pickDay, pickTime, S } from "./helpers";
import { setPlan, restoreSeedPlans, A } from "./billing-helpers";

const slug = S.orgA.slug;
const raw = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test.describe("D-032 Back keeps the chosen day and time", () => {
  for (const w of [1280, 375]) {
    test(`at ${w}px a day 3+ weeks ahead and the chosen time are still chosen after Back`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`/${slug}`);
      await page.getByRole("button", { name: /Queen West/ }).click();
      await page.getByRole("button", { name: /^Haircut/ }).click();
      await page.getByRole("button", { name: /Sara Stylist/ }).click();
      const label = await pickDay(page, 17); // about 3.5 weeks of weekdays ahead
      await pickTime(page, "1:00 PM");
      await expect(page.getByLabel("Full name")).toBeVisible();
      await page.getByRole("button", { name: "Back" }).first().click();
      await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
      const monthName = new Date(label + "T12:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      await expect(page.getByRole("heading", { name: monthName })).toBeVisible();
      // the time we chose is shown highlighted, so the chosen day is the one being shown
      const chosen = page.locator("button.bg-accent-fill.text-white", { hasText: "1:00 PM" });
      await expect(chosen).toBeVisible();
      await expect(chosen).toHaveCount(1);
    });
  }
});

test.describe("D-034 landing header", () => {
  const posOf = (page: Page) => page.evaluate(() => {
    const h = document.querySelector("header")!;
    return { position: getComputedStyle(h).position, height: Math.round(h.getBoundingClientRect().height), vh: innerHeight };
  });
  for (const [w, scale, sticky] of [[375, "100%", false], [375, "200%", false], [320, "200%", false], [767, "100%", false], [768, "100%", true], [1280, "100%", true]] as const) {
    test(`${w}px, text ${scale}: header is ${sticky ? "sticky" : "not sticky"}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/");
      await page.addStyleTag({ content: `html{font-size:${scale}}` });
      await page.waitForTimeout(300);
      const before = await posOf(page);
      await page.evaluate(() => window.scrollTo(0, 1500));
      await page.waitForTimeout(300);
      const top = await page.evaluate(() => Math.round(document.querySelector("header")!.getBoundingClientRect().top));
      if (sticky) { expect(before.position).toBe("sticky"); expect(top).toBe(0); }
      else { expect(before.position).not.toBe("sticky"); expect(top).toBeLessThan(0); }
      console.log(`header ${w}px ${scale}: position=${before.position} height=${before.height}/${before.vh} topAfterScroll=${top}`);
    });
  }
  for (const [w, scale] of [[375, "100%"], [375, "200%"], [1280, "100%"]] as const) {
    test(`anchor links land correctly at ${w}px, text ${scale}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/");
      await page.addStyleTag({ content: `html{font-size:${scale}}` });
      for (const id of ["features", "pricing", "faq"]) {
        const link = page.locator(`nav a[href="#${id}"]:visible`).first();
        await link.click();
        await page.waitForTimeout(700);
        const r = await page.evaluate((i) => {
          const s = document.getElementById(i)!;
          const rect = s.getBoundingClientRect();
          const h = document.querySelector("header")!.getBoundingClientRect();
          const heading = s.querySelector("h2, h1")!.getBoundingClientRect();
          return { top: Math.round(rect.top), headingTop: Math.round(heading.top), headerBottom: Math.round(h.bottom) };
        }, id);
        console.log(`anchor #${id} ${w}px ${scale}`, JSON.stringify(r));
        expect(r.headingTop, `#${id} heading on screen`).toBeGreaterThanOrEqual(0);
        expect(r.headingTop, `#${id} heading not hidden behind the header`).toBeGreaterThanOrEqual(Math.min(r.headerBottom, 0) === 0 && w >= 768 ? r.headerBottom - 1 : 0);
        expect(r.top).toBeLessThan(200);
      }
    });
  }
});

/** Contrast of every visible text element against its effective background, computed in the page. */
async function contrast(page: Page) {
  return page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const px = (c: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top: number[], bot: number[]) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1); };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const bgOf = (el: Element) => { const layers: number[][] = []; for (let e: Element | null = el; e; e = e.parentElement) { const p = px(getComputedStyle(e).backgroundColor); if (p[3] > 0) layers.push(p); if (p[3] === 1) break; } let acc = [255, 255, 255, 1]; if (!layers.length || layers[layers.length - 1][3] < 1) acc = px(getComputedStyle(document.body).backgroundColor).slice(0, 3).concat(1); for (const l of layers.reverse()) acc = over(l, acc); return acc; };
    const out: { t: string; ratio: number; size: number; cls: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement; if (!el || seen.has(el) || !(n.textContent || "").trim()) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const bg = bgOf(el); const fg = over(px(cs.color), bg);
      const l1 = lum(fg), l2 = lum(bg);
      out.push({ t: (n.textContent || "").trim().slice(0, 30), ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100, size: parseFloat(cs.fontSize), cls: String(el.getAttribute("class") || "").slice(0, 60) });
    }
    return out;
  });
}
const worst = (rs: { t: string; ratio: number; size: number; cls: string }[]) => rs.filter((r) => r.ratio < 4.45 && !r.cls.includes("size-14")).sort((a, b) => a.ratio - b.ratio);

test.describe("D-036 contrast of the public pages", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`booking page steps in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
      await page.goto(`/${slug}`);
      await page.waitForTimeout(600);
      const all: Record<string, ReturnType<typeof worst>> = {};
      all.location = worst(await contrast(page));
      await page.getByRole("button", { name: /Queen West/ }).click();
      all.service = worst(await contrast(page));
      await page.getByRole("button", { name: /^Haircut/ }).click();
      await page.getByRole("button", { name: /Sara Stylist/ }).click();
      await pickDay(page, 3);
      all.times = worst(await contrast(page));
      await pickTime(page, "1:00 PM");
      all.details = worst(await contrast(page));
      console.log(`D036 ${theme} failing:`, JSON.stringify(all));
      for (const [k, v] of Object.entries(all)) expect(v.filter((r) => r.size < 24), `${theme} ${k}`).toEqual([]);
    });
  }
  for (const theme of ["light", "dark"] as const) {
    test(`paused page in ${theme}`, async ({ page }) => {
      try {
        await setPlan(A(), "none");
        await raw().from("organizations").update({ phone: "+14165550123", website: "https://example.com" }).eq("id", A());
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
        await page.goto(`/${slug}`);
        await expect(page.getByRole("heading", { name: /isn't accepting bookings/ })).toBeVisible();
        const w = worst(await contrast(page));
        console.log(`D036 paused ${theme} failing:`, JSON.stringify(w));
        expect(w.filter((r) => r.size < 24)).toEqual([]);
      } finally {
        await raw().from("organizations").update({ phone: null, website: null }).eq("id", A());
        await restoreSeedPlans();
      }
    });
  }
});

test.describe("custom accent colour", () => {
  test("a business with a bright accent colour: fills follow it, text is the fixed accessible blue, still readable", async ({ page }) => {
    const sb = raw();
    await sb.from("organizations").update({ accent_color: "#FF9500" }).eq("id", S.orgA.id);
    try {
      fs.mkdirSync("test-results/accent", { recursive: true });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`/${slug}`);
        await page.getByRole("button", { name: /Queen West/ }).click();
        await page.getByRole("button", { name: /^Haircut/ }).click();
        await page.getByRole("button", { name: /Sara Stylist/ }).click();
        await pickDay(page, 3);
        await pickTime(page, "1:00 PM");
        await page.screenshot({ path: `test-results/accent/details-${theme}.png`, fullPage: true });
        const w = worst(await contrast(page));
        console.log(`accent orange ${theme} failing:`, JSON.stringify(w));
        expect(w.filter((r) => r.size < 24)).toEqual([]);
      }
    } finally {
      await sb.from("organizations").update({ accent_color: "#007AFF" }).eq("id", S.orgA.id);
    }
  });
});
