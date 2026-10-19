// Not a test of behaviour: takes the landing page screenshots kept in project/marketing/landing-screenshots/ (re-run to refresh them).
import { test } from "./fixtures";
import path from "node:path";
import { S } from "./helpers";

const OUT = path.join(__dirname, "..", "..", "project", "marketing", "landing-screenshots");
const sizes = [{ w: 375, h: 812 }, { w: 1280, h: 900 }];

for (const theme of ["light", "dark"] as const) {
  for (const sz of sizes) {
    test(`signed out ${sz.w} ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
      await page.setViewportSize({ width: sz.w, height: sz.h });
      await page.goto("/");
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `landing-${sz.w}-${theme}-out.png`), fullPage: true });
    });
    test(`signed in ${sz.w} ${theme}`, async ({ pageAs }) => {
      const page = await pageAs("ownerA");
      await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
      await page.setViewportSize({ width: sz.w, height: sz.h });
      await page.goto("/");
      await page.evaluate((t) => localStorage.setItem("tempo-theme", t), theme);
      await page.reload();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `signedin-${sz.w}-${theme}.png`), fullPage: true });
    });
    test(`booking page ${sz.w} ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
      await page.setViewportSize({ width: sz.w, height: sz.h });
      await page.goto(`/${S.orgA.slug}`);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `booking-page-${sz.w}-${theme}.png`), fullPage: true });
    });
  }
}
