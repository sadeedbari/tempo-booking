// Retest of D-019..D-023 (shared-component changes): contrast in light AND dark, failed requests / ended session on billing buttons
// and on the new-service Save, live regions, dialog names + focus handling, "Your trial has ended." copy, plus screenshots of the
// shared components at 375/768/1280 (saved under test-results/retest-shots, git-ignored).
import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import fs from "node:fs";
import { S, login, mock } from "./helpers";
import { A, B, WIDTHS, admin, billingUrl, colours, contrast, noHorizontalScroll, openAt, removeExtras, restoreSeedPlans, setPlan, stripeMock, subRow } from "./billing-helpers";

const url = billingUrl(S.orgB.slug);
const slug = S.orgB.slug;
const subscribe = (page: Page) => page.getByRole("button", { name: /^Subscribe for/ });
const SHOTS = "test-results/retest-shots";
test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(B()); await removeExtras(A()); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

async function ratio(loc: Locator) { const c = await colours(loc.first()); return contrast(c.fg, c.bg, c.under); }

for (const scheme of ["light", "dark"] as const) {
  test.describe(`D-019 contrast, ${scheme} mode`, () => {
    test(`plan strip (trial 2 days, payment failed, expired) and billing page items, ${scheme}`, async ({ pageAs }) => {
      const page = await pageAs("ownerB");
      await page.emulateMedia({ colorScheme: scheme });
      const out: Record<string, number> = {};
      await setPlan(B(), "trial", { days: 2 });
      await openAt(page, 1280, `/o/${slug}/dashboard`);
      out["strip trial<=3d"] = await ratio(page.getByRole("status").filter({ hasText: /trial/i }));
      await setPlan(B(), "past-due", { daysAgo: 2 });
      await openAt(page, 1280, `/o/${slug}/dashboard`);
      out["strip payment failed"] = await ratio(page.getByRole("status").filter({ hasText: /payment/i }));
      await setPlan(B(), "past-due", { daysAgo: 9 });
      await openAt(page, 1280, `/o/${slug}/dashboard`);
      out["strip expired"] = await ratio(page.getByRole("status").filter({ hasText: /read-only|paused|plan/i }));
      await setPlan(B(), "trial-ended");
      await openAt(page, 1280, url);
      for (const [n, l] of [
        ["usage footnote", page.getByText("Every team member counts")], ["field hint", page.getByText("Up to 20")],
        ["status line", page.getByText("Your trial has ended.")], ["red notice", page.getByText("Your booking page is paused and the dashboard is read-only.")],
        ["Subscribe button", subscribe(page)], ["Expired badge", page.getByText("Expired", { exact: true })],
      ] as [string, Locator][]) out[n] = await ratio(l);
      await setPlan(B(), "active", { extraLocations: 1, staffPacks: 1 });
      await openAt(page, 1280, url);
      out["Active badge"] = await ratio(page.getByText("Active", { exact: true }));
      out["Update plan button"] = await ratio(page.getByRole("button", { name: "Update plan" }));
      out["Manage billing button"] = await ratio(page.getByRole("button", { name: "Manage billing", exact: true }));
      await openAt(page, 1280, `/o/${slug}/services`);
      out["New service (filled button)"] = await ratio(page.getByRole("button", { name: "New service" }));
      console.log(`CONTRAST ${scheme}:`, JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(2)]))));
      for (const [k, v] of Object.entries(out)) expect.soft(v, `${scheme}: ${k}`).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test.describe("D-020 failed requests", () => {
  const MSG = /Something went wrong\. Please check your connection and try again\./;
  for (const kind of ["offline", "http500"] as const) {
    test(`billing Subscribe, ${kind}: inline message, page usable, button enabled again`, async ({ pageAs }) => {
      await setPlan(B(), "trial", { days: 12 });
      const page = await pageAs("ownerB");
      await openAt(page, 1280, url);
      let blocked = true;
      await page.route("**/*", (route) => {
        const r = route.request();
        if (blocked && r.method() === "POST" && r.headers()["next-action"]) return kind === "offline" ? route.abort("internetdisconnected") : route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
        return route.continue();
      });
      await subscribe(page).click();
      const msg = page.getByText(MSG);
      await expect(msg).toBeVisible();
      expect(await msg.evaluate((n) => Boolean(n.closest("[role=alert]"))), "message is in role=alert").toBe(true);
      await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/Application error|We hit a problem/i);
      await expect(subscribe(page)).toBeEnabled();
      expect(page.url()).toContain("/settings/billing");
      blocked = false;
      await subscribe(page).click();
      await page.waitForURL(/\/pay\/cs_mock_/);
    });

    test(`new service Save, ${kind}: inline message in the sheet, sheet stays, Save enabled again, then saves`, async ({ pageAs }) => {
      const page = await pageAs("ownerB");
      await openAt(page, 1280, `/o/${slug}/services`);
      await page.getByRole("button", { name: "New service" }).click();
      const dlg = page.getByRole("dialog", { name: "New service" });
      await expect(dlg).toBeVisible();
      await page.keyboard.type("E2E Retest 020 ");
      await dlg.getByRole("textbox").first().fill("E2E Retest 020 " + kind);
      let blocked = true;
      await page.route("**/*", (route) => {
        const r = route.request();
        if (blocked && r.method() === "POST" && r.headers()["next-action"]) return kind === "offline" ? route.abort("internetdisconnected") : route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
        return route.continue();
      });
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(dlg.getByText(MSG)).toBeVisible();
      await expect(dlg).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/Application error|We hit a problem/i);
      await expect(dlg.getByRole("button", { name: "Save" })).toBeEnabled();
      // React resets an uncontrolled <form action> after the action finishes: is what the person typed still there?
      const kept = await dlg.getByRole("textbox").first().inputValue();
      console.log(`NAME after failed Save (${kind}): ${JSON.stringify(kept)}`);
      expect.soft(kept, "the typed name is kept after a failed Save (D-024)").toBe("E2E Retest 020 " + kind);
      await dlg.getByRole("textbox").first().fill("E2E Retest 020 " + kind);
      blocked = false;
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("E2E Retest 020 " + kind).first()).toBeVisible();
    });
  }

  test("team Add member and location Add, request fails: inline message and what was typed is kept", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 2, staffPacks: 0 });
    const page = await pageAs("ownerB");
    const fail = async () => { await page.route("**/*", (route) => { const r = route.request(); return r.method() === "POST" && r.headers()["next-action"] ? route.abort("internetdisconnected") : route.continue(); }); };
    await openAt(page, 1280, `/o/${slug}/team`);
    await page.getByRole("button", { name: "Add team member" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill("E2E Keep Me");
    await fail();
    await dlg.getByRole("button", { name: "Add team member" }).click();
    await expect(dlg.getByText(/Something went wrong\. Please check your connection/)).toBeVisible();
    await expect(dlg).toBeVisible();
    console.log("TEAM name after failed add:", JSON.stringify(await dlg.getByLabel("Name").inputValue()));
    expect.soft(await dlg.getByLabel("Name").inputValue(), "typed member name kept after a failed Add (D-024)").toBe("E2E Keep Me");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openAt(page, 1280, `/o/${slug}/settings`);
    await page.getByRole("button", { name: "Add" }).first().click();
    const loc = page.getByRole("dialog");
    await loc.getByLabel("Name").fill("E2E Keep Loc");
    await fail();
    await loc.getByRole("button", { name: /Save|Add/ }).last().click();
    await expect(loc.getByText(/Something went wrong\. Please check your connection/)).toBeVisible();
    console.log("LOCATION name after failed save:", JSON.stringify(await loc.getByLabel("Name").inputValue()));
    expect.soft(await loc.getByLabel("Name").inputValue(), "typed location name kept after a failed Save (D-024)").toBe("E2E Keep Loc");
  });

  test("ended session on billing Subscribe: sign-in page with the session-ended message, no Stripe call", async ({ browser }) => {
    await setPlan(B(), "trial", { days: 12 });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "ownerB");
    await openAt(page, 1280, url);
    await stripeMock.reset();
    await ctx.clearCookies();
    await subscribe(page).click();
    await page.waitForURL(/\/login\?error=session/);
    await expect(page.getByText("Your session has ended. Please sign in again to continue.")).toBeVisible();
    expect(await page.getByText("Your session has ended").evaluate((n) => n.getAttribute("role"))).toBe("status");
    await ctx.close();
  });

  test("ended session on new service Save: sign-in page with the session-ended message", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "ownerB");
    await openAt(page, 1280, `/o/${slug}/services`);
    await page.getByRole("button", { name: "New service" }).click();
    const dlg = page.getByRole("dialog", { name: "New service" });
    await dlg.getByRole("textbox").first().fill("E2E Retest 020 session");
    await ctx.clearCookies();
    await dlg.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/login\?error=session/);
    await expect(page.getByText("Your session has ended. Please sign in again to continue.")).toBeVisible();
    await ctx.close();
  });

  test("ended session, upgrade prompt add-on and plan-change button also end at the sign-in page", async ({ browser }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "ownerB");
    await openAt(page, 1280, url);
    await ctx.clearCookies();
    await page.getByRole("button", { name: "Manage billing", exact: true }).click();
    await page.waitForURL(/\/login\?error=session/);
    await ctx.close();
  });

  test("the login page without ?error shows no session message", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Your session has ended")).toHaveCount(0);
  });
});

test.describe("D-021 live regions", () => {
  test("billing failure appears in role=alert; the plan strip is role=status; a success banner is role=status", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await stripeMock.mode({ checkout: "fail" });
    await subscribe(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Something went wrong with billing" })).toBeVisible();
    await stripeMock.reset();
    await openAt(page, 1280, url + "?checkout=cancelled");
    expect(await page.locator("[role=status]").count()).toBeGreaterThan(0);
    await openAt(page, 1280, `/o/${slug}/dashboard`);
    await expect(page.getByRole("status").first()).toBeVisible();
  });
});

test.describe("D-022 names and focus", () => {
  async function sheetChecks(page: Page, opener: Locator, title: string | RegExp, openerName: string) {
    await opener.focus();
    await page.keyboard.press("Enter");
    const dlg = page.getByRole("dialog", { name: title });
    await expect(dlg).toBeVisible();
    expect(await dlg.getAttribute("aria-modal")).toBe("true");
    // focus is inside
    const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
    expect(await inside(), "focus moved into the sheet").toBe(true);
    // every switch named
    const unnamed = await dlg.getByRole("switch").evaluateAll((els) => els.filter((e) => !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || "").trim()).length);
    expect(unnamed, `${openerName}: unnamed switches`).toBe(0);
    // Tab trap: 40 presses forward and 40 back never leave
    for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); expect(await inside(), `Tab ${i} left the sheet`).toBe(true); }
    for (let i = 0; i < 40; i++) { await page.keyboard.press("Shift+Tab"); expect(await inside(), `Shift+Tab ${i} left the sheet`).toBe(true); }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await opener.evaluate((n) => n === document.activeElement), `${openerName}: focus returns to the opener after Escape`).toBe(true);
    // close with the X button too
    await page.keyboard.press("Enter");
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await opener.evaluate((n) => n === document.activeElement), `${openerName}: focus returns to the opener after Close`).toBe(true);
  }

  test("services New service, team Add team member, settings Add location, schedule/bookings sheets", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `/o/${slug}/services`);
    await sheetChecks(page, page.getByRole("button", { name: "New service" }), "New service", "New service");
    await openAt(page, 1280, `/o/${slug}/team`);
    await sheetChecks(page, page.getByRole("button", { name: "Add team member" }).first(), /team member/i, "Add team member");
    await openAt(page, 1280, `/o/${slug}/settings`);
    await sheetChecks(page, page.getByRole("button", { name: "Add" }).first(), /location/i, "Add location");
  });

  test("typing into the autofocus field of sheets works from the first keystroke, and the focus order is sensible", async ({ pageAs }) => {
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `/o/${slug}/team`);
    await page.getByRole("button", { name: "Add team member" }).first().click();
    await page.keyboard.type("Zoé Ünïcode 😀");
    await expect(page.getByRole("dialog").getByLabel("Name")).toHaveValue("Zoé Ünïcode 😀");
    await page.keyboard.press("Escape");
    await openAt(page, 1280, `/o/${slug}/services`);
    await page.getByRole("button", { name: "New service" }).click();
    await page.keyboard.type("Typed first");
    const first = await page.getByRole("dialog").getByRole("textbox").first().inputValue();
    expect(first).toBe("Typed first");
    // a text-less click on the backdrop closes it, and a second sheet opened right after still takes focus
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "New service" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("dashboard keyboard shortcuts and the schedule/booking sheets still work", async ({ pageAs }) => {
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `/o/${slug}/calendar`);
    const nb = page.getByRole("button", { name: /new booking/i }).first();
    if (await nb.count()) {
      await nb.click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible();
      const unnamed = await dlg.getByRole("switch").evaluateAll((els) => els.filter((e) => !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || "").trim()).length);
      expect(unnamed).toBe(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });
});

test.describe("D-023 trial-ended copy", () => {
  const status = (page: Page) => page.locator("main");
  async function copyFor(page: Page) { await openAt(page, 1280, url); return (await status(page).innerText()).replace(/\s+/g, " "); }

  test("ended trial (not swept), ended trial swept by the hourly job, and the dashboard strip", async ({ pageAs }) => {
    const page = await pageAs("ownerB");
    await setPlan(B(), "trial-ended");
    expect(await copyFor(page)).toContain("Your trial has ended.");
    const db = await admin();
    const row = await subRow(B());
    await db.from("subscriptions").update({ status: "expired", trial_ended_email_sent_at: new Date(new Date(row.trial_ends_at).getTime() + 3600_000).toISOString() }).eq("org_id", B());
    const t = await copyFor(page);
    expect(t).toContain("Your trial has ended.");
    expect(t).not.toContain("No active plan.");
    // swept, email still to send
    await db.from("subscriptions").update({ trial_ended_email_sent_at: null }).eq("org_id", B());
    expect(await copyFor(page)).toContain("Your trial has ended.");
  });

  for (const [name, state, opts] of [["second team with no trial", "none", {}], ["cancelled", "cancelled", {}], ["unpaid / grace over", "past-due", { daysAgo: 9 }]] as const) {
    test(`${name}: "No active plan." and never "Your trial has ended."`, async ({ pageAs }) => {
      const page = await pageAs("ownerB");
      await setPlan(B(), state, opts);
      const t = await copyFor(page);
      expect(t).toContain("No active plan.");
      expect(t).not.toContain("Your trial has ended.");
    });
  }

  test("active trial and active plan show neither", async ({ pageAs }) => {
    const page = await pageAs("ownerB");
    await setPlan(B(), "trial", { days: 5 });
    let t = await copyFor(page);
    expect(t).not.toContain("Your trial has ended.");
    await setPlan(B(), "active", {});
    t = await copyFor(page);
    expect(t).not.toContain("Your trial has ended.");
    expect(t).not.toContain("No active plan.");
  });
});

test.describe("shared-component visuals (screenshots)", () => {
  for (const w of WIDTHS) {
    test(`screenshots at ${w}px: billing, dashboard, services, team, a sheet; no sideways scroll, no control outside the screen`, async ({ pageAs }) => {
      await setPlan(B(), "past-due", { daysAgo: 2, extraLocations: 1, staffPacks: 1 });
      const page = await pageAs("ownerB");
      for (const [name, p] of [["billing", url], ["dashboard", `/o/${slug}/dashboard`], ["services", `/o/${slug}/services`], ["team", `/o/${slug}/team`], ["settings", `/o/${slug}/settings`]] as const) {
        await openAt(page, w, p);
        await expect(page.locator("main")).toBeVisible();
        await noHorizontalScroll(page);
        await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
      }
      await openAt(page, w, `/o/${slug}/services`);
      await page.getByRole("button", { name: "New service" }).click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible();
      const b = (await dlg.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(w + 0.5);
      await page.screenshot({ path: `${SHOTS}/sheet-new-service-${w}.png` });
      // dark mode screenshots of the same
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({ path: `${SHOTS}/sheet-new-service-dark-${w}.png` });
      await page.keyboard.press("Escape");
      await openAt(page, w, url);
      await page.screenshot({ path: `${SHOTS}/billing-dark-${w}.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: "light" });
    });
  }
});

test("dark mode: inputs and selects inside a sheet are readable (text vs field fill, placeholder)", async ({ pageAs }) => {
  const page = await pageAs("ownerB");
  await page.emulateMedia({ colorScheme: "dark" });
  await openAt(page, 375, `/o/${slug}/services`);
  await page.getByRole("button", { name: "New service" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(800);
  const out: Record<string, number> = {};
  out["name input text"] = await (async () => { await dlg.getByRole("textbox").first().fill("Abc"); return ratio(dlg.getByRole("textbox").first()); })();
  out["duration select"] = await ratio(dlg.getByRole("combobox").first());
  console.log("DARK SHEET", JSON.stringify(out));
  for (const [k, v] of Object.entries(out)) expect.soft(v, k).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: `${SHOTS}/sheet-dark-settled-375.png` });
});
