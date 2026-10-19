// Retest of D-037: selected day / time chips, hovered time chip, selected intake choice, "any person" icon and the logo
// initial, for several business accent colours, light and dark, 375 and 1280px. Measures contrast from computed styles.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, pickDay, S } from "./helpers";

const slug = S.orgA.slug;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ACCENTS = ["#007AFF", "#FF9500", "#34C759", "#FFF176", "#1C1C1E"];
const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)]; return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const OUT = process.env.D037_OUT || "C:/Users/SAB/AppData/Local/Temp/claude/C--Users-SAB-Documents-GitHub-tempo-booking/8155eece-1b0e-4bc7-85f0-47d05608a490/scratchpad/d037";
const results: string[] = [];

async function styleOf(page: Page, sel: ReturnType<Page["locator"]>) {
  return sel.evaluate((el) => {
    const cs = getComputedStyle(el);
    let bg = "", p: Element | null = el.parentElement;
    for (; p; p = p.parentElement) { const b = getComputedStyle(p).backgroundColor; const m = b.match(/[\d.]+/g)!; if (m.length < 4 || Number(m[3]) > 0.99) { bg = b; break; } }
    return { color: cs.color, bg: cs.backgroundColor, pageBg: bg || "rgb(255,255,255)", outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow };
  });
}
function check(label: string, fg: string, bg: string) {
  const r = ratio(rgb(fg), rgb(bg));
  results.push(`${label}: ${r}`);
  expect.soft(r, label).toBeGreaterThanOrEqual(4.5);
}
// Logo tile / any-person icon: gradient from accent @73% (top, over the page) to accent (bottom).
function checkTile(label: string, accent: string, s: { color: string; pageBg: string }) {
  const top = hex(accent).map((v, i) => v * (0xbb / 255) + rgb(s.pageBg)[i] * (1 - 0xbb / 255));
  const fg = rgb(s.color);
  const a = ratio(fg, top), b = ratio(fg, hex(accent));
  results.push(`${label}: lightest ${a}, darkest ${b}`);
  expect.soft(Math.min(a, b), label).toBeGreaterThanOrEqual(4.5);
}

test.afterAll(async () => { fs.mkdirSync(OUT, { recursive: true }); fs.appendFileSync(`${OUT}/contrast.txt`, results.join("\n") + "\n"); });

test.describe("D-037 accent colours", () => {
  test.beforeAll(async () => {
    await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
    const { error } = await sb().from("service_questions").insert({ org_id: S.orgA.id, service_id: S.orgA.services.haircut, label: "Any allergies", type: "yes_no", options: [], required: false, position: 0 });
    expect(error).toBeNull();
  });
  test.afterAll(async () => {
    await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
    await sb().from("organizations").update({ accent_color: "#007AFF" }).eq("id", S.orgA.id);
  });

  for (const accent of ACCENTS) for (const theme of ["light", "dark"] as const) for (const w of [375, 1280]) {
    test(`${accent} ${theme} ${w}px`, async ({ page }) => {
      test.setTimeout(120_000);
      const tag = `${accent.slice(1)}-${theme}-${w}`;
      fs.mkdirSync(OUT, { recursive: true });
      await sb().from("organizations").update({ accent_color: accent }).eq("id", S.orgA.id);
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`/${slug}`);
      await page.getByRole("button", { name: /Queen West/ }).waitFor();
      const logo = page.locator("div.size-14.grid").first();
      checkTile(`${tag} logo initial (booking)`, accent, await styleOf(page, logo));
      await page.getByRole("button", { name: /Queen West/ }).click();
      await page.getByRole("button", { name: /^Haircut/ }).click();
      const any = page.getByRole("button", { name: /Any available/ }).locator("span.size-12").first();
      checkTile(`${tag} any-person icon`, accent, await styleOf(page, any));
      await page.screenshot({ path: `${OUT}/${tag}-1-staff.png` });
      await page.getByRole("button", { name: /Sara Stylist/ }).click();
      const dayLabel = await pickDay(page, 3);
      const day = page.locator(`button[aria-label="${dayLabel}"]`);
      const ds = await styleOf(page, day);
      check(`${tag} selected day`, ds.color, ds.bg);
      const times = page.locator("button.bg-accent-soft", { hasText: /^\d+:\d\d (AM|PM)$/ });
      await expect(times.first()).toBeVisible();
      const hov = times.nth(1);
      await hov.hover(); await page.waitForTimeout(400);
      const hs = await styleOf(page, hov);
      check(`${tag} hovered time chip`, hs.color, hs.bg);
      await page.screenshot({ path: `${OUT}/${tag}-2-hover.png` });
      await page.mouse.move(0, 0);
      const first = times.first();
      await first.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await page.waitForTimeout(300);
      const fs0 = await styleOf(page, first);
      results.push(`${tag} focus ring: outline=${fs0.outline} shadow=${fs0.shadow.slice(0, 60)}`);
      expect(fs0.outline.startsWith("none") && fs0.shadow === "none", `${tag} chip focus ring visible`).toBe(false);
      await page.screenshot({ path: `${OUT}/${tag}-3-focus.png` });
      const label = (await first.textContent())!.trim();
      await first.click();
      await page.getByLabel("Full name").waitFor();
      await page.getByRole("button", { name: "Back" }).first().click();
      const sel = page.locator("button.bg-accent-fill", { hasText: label });
      await expect(sel).toHaveCount(1);
      const ss = await styleOf(page, sel);
      check(`${tag} selected time chip`, ss.color, ss.bg);
      expect(ss.bg).not.toBe(ss.pageBg);
      await page.screenshot({ path: `${OUT}/${tag}-4-selected.png` });
      await sel.click();
      const curly = page.locator("label", { hasText: /^Yes$/ });
      await curly.click(); await page.mouse.move(0, 0); await page.waitForTimeout(500);
      const cs = await styleOf(page, curly);
      check(`${tag} selected intake option`, cs.color, cs.bg);
      await page.screenshot({ path: `${OUT}/${tag}-5-intake.png` });
      if ((accent === "#FFF176" && w === 375 && theme === "dark") || (accent === "#007AFF" && w === 1280 && theme === "light")) {
        await fillDetails(page, { email: customerEmail("d037") });
        await page.getByRole("button", { name: /^(Confirm|Book)/ }).last().click();
        await expect(page.getByRole("heading", { name: /booked|confirmed/i })).toBeVisible({ timeout: 20_000 });
        results.push(`${tag} full booking completed`);
        await page.screenshot({ path: `${OUT}/${tag}-6-done.png` });
      }
    });
  }

  for (const accent of ACCENTS) for (const theme of ["light", "dark"] as const) {
    test(`contact form ${accent} ${theme}`, async ({ page }) => {
      const tag = `contact-${accent.slice(1)}-${theme}`;
      fs.mkdirSync(OUT, { recursive: true });
      const { data: prev } = await sb().from("services").select("id, contact_form").eq("org_id", S.orgA.id);
      await sb().from("services").update({ contact_form: true }).eq("org_id", S.orgA.id);
      await sb().from("organizations").update({ accent_color: accent }).eq("id", S.orgA.id);
      try {
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((t) => localStorage.setItem("tempo-theme", t), theme);
        for (const w of [375, 1280]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`/${slug}/contact`);
          const logo = page.locator("div.size-12.grid").first();
          await expect(logo).toBeVisible();
          checkTile(`${tag}-${w} logo initial (contact)`, accent, await styleOf(page, logo));
          await page.screenshot({ path: `${OUT}/${tag}-${w}.png` });
        }
      } finally {
        for (const s of prev ?? []) await sb().from("services").update({ contact_form: s.contact_form }).eq("id", s.id);
      }
    });
  }
});
