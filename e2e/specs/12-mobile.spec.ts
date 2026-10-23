import { test, expect } from "./fixtures";
import { S } from "./helpers";

/** Phone-sized pass: nothing scrolls sideways, inputs are big enough not to trigger zoom, and tap targets aren't tiny. */
const base = `/o/${S.orgA.slug}`;
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const PUBLIC = ["/", "/login", "/signup", "/forgot", "/privacy", "/terms", "/sms", `/${S.orgA.slug}`, `/${S.orgA.slug}?service=haircut`, `/embed/${S.orgA.slug}`, `/${S.orgA.slug}/contact`, `/embed/${S.orgA.slug}/contact`];
const APP = ["dashboard", "calendar", "bookings", "schedule", "customers", "inquiries", "services", "workflows", "workflows/new?starter=second-reminder", "team", "availability", "settings"];

async function audit(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>("a,button,select,input,textarea,[role=switch]")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !(e instanceof HTMLInputElement && ["hidden", "checkbox", "radio"].includes(e.type));
      })
      .map((e) => ({ t: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height), tag: e.tagName }))
      .filter((x) => x.h < 30);
    const smallText = [...document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea")]
      .filter((e) => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => e.getAttribute("name") || e.tagName);
    return { overflow: doc.scrollWidth - doc.clientWidth, small, smallText };
  });
}

for (const url of PUBLIC) {
  test(`public ${url}`, async ({ page }) => {
    await page.goto(url);
    await page.waitForTimeout(600);
    const a = await audit(page);
    expect(a.overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
    expect(a.smallText, "inputs under 16px zoom on iPhone").toEqual([]);
    expect(a.small.filter((s) => s.tag !== "A").map((s) => `${s.t}:${s.h}`), "tiny buttons").toEqual([]);
  });
}

for (const p of APP) {
  test(`app ${p}`, async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/${p}`);
    await page.waitForTimeout(800);
    const a = await audit(page);
    expect(a.overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
    expect(a.smallText, "inputs under 16px zoom on iPhone").toEqual([]);
    expect(a.small.filter((s) => s.tag !== "A" && s.tag !== "INPUT").map((s) => `${s.t}:${s.h}`), "tiny buttons").toEqual([]);
  });
}

test("the bottom tab bar and More menu work and don't cover content", async ({ pageAs }) => {
  const page = await pageAs("ownerA");
  await page.goto(`${base}/dashboard`);
  const tabs = page.locator("nav").filter({ hasText: "More" });
  await expect(tabs).toBeVisible();
  await tabs.getByRole("button", { name: "More" }).click();
  for (const label of ["Customers", "Services", "Workflows", "Team", "Availability", "Settings", "Sign out"]) {
    await expect(page.getByRole("link", { name: label }).or(page.getByRole("button", { name: new RegExp(label) })).first()).toBeVisible();
  }
  await page.getByRole("link", { name: "Customers" }).first().click();
  await expect(page).toHaveURL(/customers/);
});
