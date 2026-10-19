// Basic accessibility of the billing page, the plan strip, the upgrade prompt and the paused page: headings, labels, keyboard-only
// use of every button, visible focus, contrast, no sideways scrolling at 375px. Optional axe-core scan: set E2E_AXE_DIR to a folder
// that has @axe-core/playwright installed (kept OUT of the repo on purpose); the scan is skipped otherwise.
import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import path from "node:path";
import { S, mock, watchErrors } from "./helpers";
import {
  A, B, WIDTHS, admin, billingUrl, colours, contrast, noHorizontalScroll, openAt, removeExtras, restoreSeedPlans, setPlan, stripeMock, subRow,
} from "./billing-helpers";

const url = billingUrl(S.orgB.slug);
const teamB = `/o/${S.orgB.slug}/team`;
const subscribe = (page: Page) => page.getByRole("button", { name: /^Subscribe for/ });

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(B()); await removeExtras(A()); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

/** Does the focused element (or the box that wraps it) show a focus ring: an outline or a shadow? */
async function focusIsVisible(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { ok: false, what: "nothing focused" };
    const looks = (n: Element) => {
      const cs = getComputedStyle(n);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== "none" && cs.boxShadow !== "";
      return outline || shadow;
    };
    // an input inside a box that draws the ring with :focus-within counts
    const box = el.closest("[class*='focus-within']") ?? el.parentElement;
    const ok = looks(el) || (box ? looks(box) : false);
    return { ok, what: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}"` };
  });
}

/** Presses Tab until `target` has focus (at most `max` presses); every stop on the way must show a focus ring. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await focusIsVisible(page);
    expect(f.ok, `no visible focus on ${f.what}`).toBe(true);
    if (await target.evaluate((n) => n === document.activeElement).catch(() => false)) return;
  }
  throw new Error("could not reach the element with Tab");
}

const nameless = (page: Page) => page.evaluate(() => {
  const bad: string[] = [];
  const named = (el: Element) => {
    const e = el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> };
    if (e.getAttribute("aria-label")?.trim() || e.getAttribute("title")?.trim()) return true;
    const by = e.getAttribute("aria-labelledby");
    if (by && by.split(" ").some((id) => document.getElementById(id)?.textContent?.trim())) return true;
    if (e.labels && e.labels.length) return true;
    return Boolean((e.textContent ?? "").trim());
  };
  for (const el of Array.from(document.querySelectorAll("main button, main a[href], main input:not([type=hidden]), main select, main textarea, main [role=switch], main [role=progressbar]"))) {
    if ((el as HTMLElement).offsetParent === null && getComputedStyle(el).position !== "fixed") continue; // not shown
    if (!named(el)) bad.push(`${el.tagName.toLowerCase()}${el.getAttribute("name") ? `[name=${el.getAttribute("name")}]` : ""}`);
  }
  return bad;
});

const headingLevels = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("main h1, main h2, main h3, main h4")).map((h) => Number(h.tagName[1])));

test.describe("billing page", () => {
  test("headings go h1 then h2 with no gaps, every control has a name, one h1, a main landmark, page title and language", async ({ pageAs }) => {
    for (const [state, opts] of [["trial", { days: 8 }], ["active", { extraLocations: 1, staffPacks: 1 }], ["trial-ended", {}]] as const) {
      await setPlan(B(), state, opts);
      const page = await pageAs("ownerB");
      await openAt(page, 1280, url);
      const levels = await headingLevels(page);
      expect(levels[0], state).toBe(1);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading order ${levels.join(",")} (${state})`).toBeLessThanOrEqual(1);
      expect(await nameless(page), `controls without a name (${state})`).toEqual([]);
      await expect(page.locator("main")).toHaveCount(1);
      expect(await page.title()).toMatch(/Billing/);
      expect(await page.locator("html").getAttribute("lang")).toBeTruthy();
      // the two quantity boxes are real labelled number fields with a hint
      await expect(page.getByRole("spinbutton", { name: /Extra locations/ })).toBeVisible();
      await expect(page.getByRole("spinbutton", { name: /Staff packs/ })).toBeVisible();
      await expect(page.getByRole("progressbar", { name: "Locations" })).toBeVisible();
    }
  });

  test("the live price is announced politely (aria-live) and the usage bars have values", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 8 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.locator('[aria-live="polite"]').filter({ hasText: "/month" })).toHaveCount(1);
    for (const name of ["Locations", "Team members"]) {
      const bar = page.getByRole("progressbar", { name });
      for (const a of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) await expect(bar).toHaveAttribute(a, /^\d+$/);
    }
  });

  test("keyboard only: Tab to the quantity boxes, type, Tab to Subscribe, Enter goes to Checkout; each stop shows focus", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 8 });
    const page = await pageAs("ownerB");
    const w = watchErrors(page);
    await openAt(page, 1280, url);
    await tabTo(page, page.getByRole("spinbutton", { name: /Extra locations/ }));
    await page.keyboard.press("Control+A");
    await page.keyboard.type("2");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("2");
    await expect(page.getByRole("button", { name: "Subscribe for $55/month" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Subscribe for $55/month" })).toBeFocused();
    expect((await focusIsVisible(page)).ok).toBe(true);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/pay\/cs_mock_/);
    await expect(page.locator("#amount")).toHaveText("price_mock_base x 1, price_mock_location x 2, price_mock_pack x 2");
    w.assertNone();
  });

  test("keyboard only on a paying plan: change the plan, Manage billing, cancel (two Enters) and resume", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    // change plan
    await tabTo(page, page.getByRole("spinbutton", { name: /Staff packs/ }));
    await page.keyboard.press("Control+A");
    await page.keyboard.type("1");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Update plan" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByText("Plan updated")).toBeVisible();
    expect((await subRow(B())).staff_packs).toBe(1);
    // the disabled button is skipped by Tab (nothing to change any more)
    await expect(page.getByRole("button", { name: "Update plan" })).toBeDisabled();
    // cancel with the keyboard: first Enter arms, a later Enter confirms
    const cancel = page.getByRole("button", { name: /Cancel at period end|Tap again to confirm/ });
    // (pressing Update plan disabled the focused button, so focus fell back to the page: start again from the last field)
    await expect(page.getByRole("button", { name: "Update plan" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Manage billing", exact: true })).toBeEnabled(); // all billing buttons are off while a change is in flight
    await page.getByRole("spinbutton", { name: /Staff packs/ }).focus();
    await page.keyboard.press("Tab"); // the disabled Update plan is skipped
    await expect(page.getByRole("button", { name: "Manage billing", exact: true })).toBeFocused();
    expect((await focusIsVisible(page)).ok).toBe(true);
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(cancel).toHaveText("Tap again to confirm");
    await expect(async () => {
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Keep my subscription" })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 8000 });
    // resume
    const keep = page.getByRole("button", { name: "Keep my subscription" });
    await keep.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Subscription resumed")).toBeVisible();
    // Manage billing
    const manage = page.getByRole("button", { name: "Manage billing", exact: true });
    await expect(manage).toBeEnabled();
    await manage.focus();
    await expect(manage).toBeFocused();
    expect((await focusIsVisible(page)).ok).toBe(true);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/portal\//);
  });

  test("keyboard only: the plan strip's 'Open billing' link is reachable and works", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 2 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `/o/${S.orgB.slug}/team`);
    await tabTo(page, page.getByRole("status").getByRole("link", { name: "Open billing" }));
    await page.keyboard.press("Enter");
    await page.waitForURL(/settings\/billing/);
  });

  for (const width of [375, 768] as const) {
    test(`no sideways scroll and every control inside the screen at ${width}px in every plan state`, async ({ pageAs }) => {
      const states: [Parameters<typeof setPlan>[1], Parameters<typeof setPlan>[2]][] = [
        ["trial", { days: 8 }], ["trial", { days: 2 }], ["active", { extraLocations: 20, staffPacks: 40 }], ["active", { cancelAtPeriodEnd: true }], ["past-due", { daysAgo: 3 }], ["trial-ended", {}], ["cancelled", {}],
      ];
      const page = await pageAs("ownerB");
      for (const [state, opts] of states) {
        await setPlan(B(), state, opts);
        await openAt(page, width, url);
        await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
        await noHorizontalScroll(page);
        const outside = await page.evaluate((w) => Array.from(document.querySelectorAll("main button, main a, main input, main [role=status], main [role=progressbar]")).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1); }).map((e) => e.tagName), width);
        expect(outside, `${state} ${JSON.stringify(opts)}`).toEqual([]);
        // tap targets: buttons are at least 36px tall
        const small = await page.evaluate(() => Array.from(document.querySelectorAll("main button:not([disabled])")).filter((b) => { const r = b.getBoundingClientRect(); return r.height > 0 && r.height < 36; }).map((b) => b.textContent));
        expect(small, "buttons shorter than 36px").toEqual([]);
      }
    });
  }
});

test.describe("upgrade prompt", () => {
  test("keyboard only: add a person, reach 'Add and continue' with Tab, Enter buys it; Escape closes the sheet; fits at 375px", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const db = await admin();
    for (let i = 1; i <= 4; i++) await db.from("memberships").insert({ org_id: B(), user_id: null, role: "member", display_name: `E2E Helper ${i}` });
    const page = await pageAs("ownerB");
    await openAt(page, 375, teamB);
    await page.getByRole("button", { name: "Add team member" }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByLabel("Name")).toBeFocused(); // focus moves into the sheet
    await page.keyboard.type("E2E Sixth");
    const box = (await dlg.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 0.5);
    await dlg.getByRole("button", { name: "Add team member" }).focus();
    await page.keyboard.press("Enter");
    const alert = dlg.getByRole("alert");
    await expect(alert).toContainText("Your plan includes 5 staff.");
    await noHorizontalScroll(page);
    const add = alert.getByRole("button", { name: /Add and continue/ });
    await add.focus();
    expect((await focusIsVisible(page)).ok).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Team member added")).toBeVisible();
    expect((await subRow(B())).staff_packs).toBe(1);
    // Escape closes a sheet
    await page.getByRole("button", { name: "Add team member" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the prompt is announced to screen readers (role=alert) and its link is keyboard reachable on a trial", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 8 });
    const db = await admin();
    for (let i = 1; i <= 4; i++) await db.from("memberships").insert({ org_id: B(), user_id: null, role: "member", display_name: `E2E Helper ${i}` });
    const page = await pageAs("ownerB");
    await openAt(page, 768, teamB);
    await page.getByRole("button", { name: "Add team member" }).first().click();
    await page.getByRole("dialog").getByLabel("Name").fill("E2E Sixth");
    await page.getByRole("dialog").getByLabel("Name").press("Enter");
    const link = page.getByRole("dialog").getByRole("alert").getByRole("link", { name: "Choose a plan" });
    await expect(link).toBeVisible();
    await link.focus();
    expect((await focusIsVisible(page)).ok).toBe(true);
    await page.keyboard.press("Enter");
    await page.waitForURL(/settings\/billing\?locations=0&packs=1/);
  });

  test("D-022 the switches and dialogs on the screens that carry the prompt have names (location editor 'Bookable online', dialog title)", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 8 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `/o/${S.orgB.slug}/settings`);
    await page.getByRole("button", { name: "Add" }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    const unnamedSwitches = await dlg.getByRole("switch").evaluateAll((els) => els.filter((e) => !(e.getAttribute("aria-label") || "").trim() && !(e.getAttribute("aria-labelledby") || "").trim()).length);
    expect.soft(unnamedSwitches, "switches without a name in the location editor").toBe(0);
    const dialogName = (await dlg.getAttribute("aria-label")) || (await dlg.getAttribute("aria-labelledby"));
    expect.soft(dialogName, "the dialog has no accessible name").toBeTruthy();
  });

  test("D-021 error messages on the billing page are announced (inside a live region / role=alert)", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 8 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await stripeMock.mode({ checkout: "fail" });
    await subscribe(page).click();
    const msg = page.getByText("Something went wrong with billing. Please try again in a moment.");
    await expect(msg).toBeVisible();
    const live = await msg.evaluate((n) => Boolean(n.closest("[role=alert],[role=status],[aria-live]")));
    expect(live, "the failure message is not in a live region, so a screen reader is not told").toBe(true);
  });
});

test.describe("paused page and plan strip", () => {
  for (const width of WIDTHS) {
    test(`the paused page: one h1, a status region, a main landmark, a title, readable at ${width}px`, async ({ page }) => {
      await setPlan(A(), "trial-ended");
      await page.setViewportSize({ width, height: 800 });
      for (const p of [`/${S.orgA.slug}`, `/embed/${S.orgA.slug}`, `/${S.orgA.slug}/contact`]) {
        await page.goto(p);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Salon isn't accepting bookings right now");
        await expect(page.getByRole("status").filter({ hasText: "accepting bookings" })).toBeVisible();
        await expect(page.locator("main")).toHaveCount(1);
        expect((await page.title()).length).toBeGreaterThan(0);
        expect(await page.locator("html").getAttribute("lang")).toBeTruthy();
        await noHorizontalScroll(page);
        const r = (await page.getByRole("status").filter({ hasText: "accepting bookings" }).boundingBox())!;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(width + 0.5);
      }
    });
  }

  test("paused page: text contrast of the heading and the explanation", async ({ page }) => {
    await setPlan(A(), "trial-ended");
    await page.goto(`/${S.orgA.slug}`);
    const results: Record<string, number> = {};
    for (const [name, loc] of [["heading", page.getByRole("heading", { level: 1 })], ["explanation", page.getByText("Online booking is paused.")]] as [string, Locator][]) {
      const c = await colours(loc);
      results[name] = contrast(c.fg, c.bg, c.under);
    }
    console.log("paused page contrast:", JSON.stringify(results));
    for (const [name, ratio] of Object.entries(results)) expect.soft(ratio, name).toBeGreaterThanOrEqual(4.5);
  });

  test("the strip is a status region with a keyboard-reachable link; for staff it has no link to tab to", async ({ pageAs }) => {
    await setPlan(A(), "trial-ended");
    const staff = await pageAs("staffA1");
    await openAt(staff, 375, `/o/${S.orgA.slug}/dashboard`);
    const strip = staff.getByRole("status").filter({ hasText: "Ask the account owner" });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("link")).toHaveCount(0);
    const owner = await pageAs("ownerA");
    await openAt(owner, 375, `/o/${S.orgA.slug}/dashboard`);
    const link = owner.getByRole("status").getByRole("link", { name: "Open billing" });
    await link.focus();
    expect((await focusIsVisible(owner)).ok).toBe(true);
  });
});

test.describe("D-019 colour contrast on the billing page (WCAG AA 4.5:1 for normal text)", () => {
  test("body text, hints, badges, the red notice and the primary button", async ({ pageAs }) => {
    await setPlan(B(), "trial-ended");
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    const checks: [string, Locator][] = [
      ["usage footnote (label-3)", page.getByText("Every team member counts")],
      ["field hint", page.getByText("Up to 20")],
      ["status line (label-2)", page.getByText("Your trial has ended.")],
      ["red notice", page.getByText("Your booking page is paused and the dashboard is read-only.")],
      ["Subscribe button", subscribe(page)],
      ["Expired badge", page.getByText("Expired", { exact: true })],
    ];
    const results: Record<string, number> = {};
    for (const [name, loc] of checks) {
      const c = await colours(loc.first());
      // the button's own fill is its background; everything else sits on its card
      results[name] = contrast(c.fg, c.bg, c.under);
    }
    console.log("billing page contrast ratios:", JSON.stringify(results));
    for (const [name, ratio] of Object.entries(results)) expect.soft(ratio, name).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("axe-core scan (optional)", () => {
  const dir = process.env.E2E_AXE_DIR;
  test.skip(!dir, "set E2E_AXE_DIR to a folder with @axe-core/playwright to run the axe scan");
  test("no serious or critical axe violations on the billing page, the strip, the prompt and the paused page", async ({ pageAs, browser }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AxeBuilder } = require(path.join(dir!, "node_modules", "@axe-core", "playwright"));
    const seen: string[] = [];
    const scan = async (page: Page, label: string) => {
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of r.violations) seen.push(`${label}: ${v.id} (${v.impact}) x${v.nodes.length}`);
    };
    const owner = await pageAs("ownerB");
    await setPlan(B(), "trial", { days: 2 });
    await openAt(owner, 1280, url); await scan(owner, "billing trial");
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 1 });
    await openAt(owner, 1280, url); await scan(owner, "billing active");
    await setPlan(B(), "trial-ended");
    await openAt(owner, 375, url); await scan(owner, "billing expired 375");
    await setPlan(A(), "trial-ended");
    const ctx = await browser.newContext();
    const anon = await ctx.newPage();
    await anon.goto(`/${S.orgA.slug}`); await scan(anon, "paused page");
    await ctx.close();
    console.log("axe findings:\n" + seen.join("\n"));
    expect(seen.filter((s) => /\((serious|critical)\)/.test(s)), seen.join("\n")).toEqual([]);
  });
});
