import { test, expect } from "./fixtures";
import { S } from "./helpers";
import type { Page } from "@playwright/test";

/**
 * A "monkey" pass: on every page, for every role, click everything clickable (in random order) and feed odd text
 * into any form that opens. Nothing may throw an uncaught error, show the error screen, or answer with a 5xx.
 */
const base = `/o/${S.orgA.slug}`;
const PAGES = ["dashboard", "calendar", "bookings", "schedule", "customers", "inquiries", "services", "workflows", "team", "availability", "settings"];
const SKIP = /sign out|log out|logout|delete team|yes, delete|turn on notifications|connect stripe|connect (google|outlook)|open stripe|export to excel|booking page/i;
const NASTY = ["<script>alert(1)</script>", "'; DROP TABLE bookings;--", "Zoë 李雷 ‮", "x".repeat(600), "   ", "-1", "9".repeat(30)];

function trap(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  page.on("dialog", (d) => { problems.push(`browser dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
  return problems;
}
async function broken(page: Page) {
  const t = (await page.locator("body").innerText().catch(() => "")) || "";
  return /Application error|Something went wrong|Internal Server Error|This page couldn.t load/i.test(t) ? t.slice(0, 160) : null;
}

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const shuffle = <T,>(a: T[]) => a.map((v) => [rnd(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

async function poke(page: Page, url: string, problems: string[], clicks = 25) {
  await page.goto(url);
  for (let i = 0; i < clicks; i++) {
    const targets = page.locator("main button:visible, main [role=switch]:visible, main a[href^='/']:visible, dialog button:visible, [role=dialog] button:visible");
    const n = await targets.count();
    if (n === 0) break;
    const el = targets.nth(Math.floor(rnd() * n));
    // Short timeouts: a button that re-rendered away mid-pick must not stall the crawl until the test times out.
    const label = ((await el.innerText({ timeout: 1500 }).catch(() => "")) + " " + ((await el.getAttribute("aria-label", { timeout: 1500 }).catch(() => "")) ?? "")).trim();
    if (SKIP.test(label)) continue;
    const href = await el.getAttribute("href", { timeout: 1500 }).catch(() => null);
    if (href && /^\/(api|auth|booking|embed|login|signup|invite|onboarding)/.test(href)) continue;
    await el.click({ timeout: 2500, trial: false }).catch(() => {});
    await page.waitForTimeout(150);
    // a form opened: put odd text in every field and try to submit it
    const dialog = page.getByRole("dialog");
    if (await dialog.count()) {
      const fields = dialog.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=number]), textarea");
      const fc = await fields.count();
      for (let f = 0; f < fc; f++) await fields.nth(f).fill(NASTY[Math.floor(rnd() * NASTY.length)], { timeout: 1000 }).catch(() => {});
      const buttons = dialog.getByRole("button");
      const bc = await buttons.count();
      if (bc) {
        const b = buttons.nth(bc - 1);
        const bl = (await b.innerText().catch(() => "")).trim();
        if (!SKIP.test(bl)) await b.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    const text = await broken(page);
    if (text) { problems.push(`error screen after clicking "${label.slice(0, 40)}": ${text}`); await page.goto(url); }
    if (new URL(page.url()).pathname !== new URL(url, page.url()).pathname) await page.goto(url);
  }
}

for (const who of ["ownerA", "adminA", "staffA1"] as const) {
  test.describe(`monkey: ${who}`, () => {
    for (const p of PAGES) {
      test(`${p}`, async ({ pageAs }) => {
        test.setTimeout(280_000);
        const page = await pageAs(who);
        const problems = trap(page);
        await poke(page, `${base}/${p}`, problems);
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  });
}

test.describe("monkey: the public pages", () => {
  for (const url of [`/${S.orgA.slug}`, `/${S.orgA.slug}?service=haircut`, `/embed/${S.orgA.slug}`, "/", "/login", "/signup", "/privacy", "/terms"]) {
    test(url, async ({ page }) => {
      test.setTimeout(120_000);
      const problems = trap(page);
      await page.goto(url);
      for (let i = 0; i < 20; i++) {
        const t = page.locator("button:visible, a[href^='/']:visible");
        const n = await t.count();
        if (!n) break;
        const el = t.nth(Math.floor(rnd() * n));
        const label = (await el.innerText().catch(() => "")).trim();
        const href = await el.getAttribute("href").catch(() => null);
        if (SKIP.test(label) || (href && /^\/(api|auth)/.test(href))) continue;
        await el.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(120);
        if (await broken(page)) { problems.push(`error screen after "${label.slice(0, 30)}"`); await page.goto(url); }
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});
