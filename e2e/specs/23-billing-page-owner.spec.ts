// Billing page, as the owner: trial, plan chooser, Checkout (stand-in) and return, active plan, plan change, cancel and resume,
// Manage billing, tampered quantities. Team B (E2E Clinic, owner Bea) is the team whose plan is moved around.
import { test, expect } from "./fixtures";
import { S, mock, watchErrors } from "./helpers";
import {
  B, WIDTHS, billingUrl, bodyText, captureAction, choose, extraLocationsInput, liveTotal, noHorizontalScroll, openAt, removeExtras, replayAction,
  restoreSeedPlans, setPlan, sizeFor, staffPacksInput, stripeMock, subRow, admin,
} from "./billing-helpers";

const url = billingUrl(S.orgB.slug);
const subscribe = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Subscribe for/ });
const updatePlan = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Update plan" });
const cancelBtn = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /Cancel at period end|Tap again to confirm/ });
const manage = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Manage billing", exact: true });

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(B()); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

test.describe("trial", () => {
  for (const width of WIDTHS) {
    test(`shows days left, usage against the limits and the plan chooser at ${width}px`, async ({ pageAs }) => {
      await setPlan(B(), "trial", { days: 9 });
      const page = await pageAs("ownerB");
      const w = watchErrors(page);
      await openAt(page, width, url);
      await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
      await expect(page.getByText("9 days left. Your trial ends", { exact: false })).toBeVisible();
      await expect(page.getByText("No card needed until you subscribe.")).toBeVisible();
      await expect(page.getByText("Free trial", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("progressbar", { name: "Locations" })).toHaveAttribute("aria-valuemax", "1");
      await expect(page.getByRole("progressbar", { name: "Team members" })).toHaveAttribute("aria-valuemax", "5");
      await expect(page.getByText("0 of 1")).toBeVisible();
      await expect(page.getByText("1 of 5")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
      await expect(liveTotal(page)).toContainText("1 location, 5 staff");
      await expect(liveTotal(page)).toContainText("$15");
      await expect(subscribe(page)).toBeEnabled();
      await expect(subscribe(page)).toHaveText("Subscribe for $15/month");
      // a trial has no subscription: no card, change-plan or cancel sections
      await expect(manage(page)).toHaveCount(0);
      await expect(cancelBtn(page)).toHaveCount(0);
      await expect(updatePlan(page)).toHaveCount(0);
      await noHorizontalScroll(page);
      w.assertNone();
    });
  }

  test("the last day reads '1 day left' (singular)", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 1 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.getByText("1 day left. Your trial ends")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Free trial: 1 day left." })).toBeVisible();
  });

  test("the live price follows the choice: $15, $30, $20, $55 (3 locations / 25 staff), and the largest plan", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    const cases: [number, number, string, string][] = [
      [0, 0, "$15", "1 location, 5 staff"],
      [1, 0, "$30", "2 locations, 10 staff"],
      [0, 1, "$20", "1 location, 10 staff"],
      [1, 1, "$35", "2 locations, 15 staff"],
      [2, 2, "$55", "3 locations, 25 staff"],
      [20, 40, "$515", "21 locations, 305 staff"],
    ];
    for (const [loc, packs, price, limits] of cases) {
      await choose(page, loc, packs);
      await expect(liveTotal(page)).toContainText(limits);
      await expect(liveTotal(page)).toContainText(price);
      await expect(subscribe(page)).toHaveText(`Subscribe for ${price}/month`);
    }
  });

  test("typing nonsense in the quantity boxes is cleaned up in the screen (empty, negative, fractional, huge)", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    const loc = extraLocationsInput(page);
    const packs = staffPacksInput(page);
    await loc.fill("-3");
    await expect(loc).toHaveValue("0");
    await loc.fill("2.7");
    await expect(liveTotal(page)).toContainText("$45"); // 2 extra locations: fractions are cut off
    await loc.fill("999");
    await expect(loc).toHaveValue("20");
    await loc.fill("");
    await expect(liveTotal(page)).toContainText("$15");
    await packs.fill("41");
    await expect(packs).toHaveValue("40");
    await packs.fill("-0.5");
    await expect(liveTotal(page)).toContainText("$15");
    // letters can't be typed into a number box at all
    await loc.fill("");
    await loc.pressSequentially("abc");
    await expect(loc).toHaveValue("0");
    await expect(subscribe(page)).toBeEnabled();
  });

  test("the plan in the address (?locations=&packs=, as sent by an upgrade prompt) pre-fills the chooser; junk in it is ignored", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `${url}?locations=1&packs=2`);
    await expect(extraLocationsInput(page)).toHaveValue("1");
    await expect(staffPacksInput(page)).toHaveValue("2");
    await expect(liveTotal(page)).toContainText("$40");
    for (const q of ["locations=-1&packs=0", "locations=1.5&packs=0", "locations=999&packs=0", "locations=abc&packs=1", "locations=%3Cscript%3E&packs=1"]) {
      await page.goto(`${url}?${q}`);
      await expect(extraLocationsInput(page)).toHaveValue("0");
      await expect(staffPacksInput(page)).toHaveValue("0");
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  });
});

test.describe("subscribe through Checkout", () => {
  for (const width of WIDTHS) {
    test(`Subscribe goes to Checkout, paying returns to an active plan with a fresh banner at ${width}px`, async ({ pageAs }) => {
      await setPlan(B(), "trial", { days: 12 });
      const page = await pageAs("ownerB");
      const w = watchErrors(page);
      await openAt(page, width, url);
      await expect(page.getByRole("status").filter({ hasText: "Free trial: 12 days left." })).toBeVisible();
      await choose(page, 1, 0);
      await subscribe(page).click();
      await page.waitForURL(/127\.0\.0\.1:4010\/pay\/cs_mock_/);
      // what Tempo asked Stripe for: the three prices only, quantities from the screen, monthly, back to this page
      await expect(page.locator("#amount")).toHaveText("price_mock_base x 1, price_mock_location x 1");
      const [call] = await stripeMock.calls("/v1/checkout/sessions");
      expect(call.body.mode).toBe("subscription");
      expect(call.body.cancel_url).toContain(url);
      expect(call.body.success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
      await page.click("#pay");
      await page.waitForURL(/checkout=done/);
      await expect(page.getByText("Thanks! Your subscription is active.")).toBeVisible();
      await expect(page.getByText("2 locations, 10 staff", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("$30/month", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
      await expect(page.getByText(/Next invoice:/)).toContainText("$30");
      // D-014: the strip above the page is not the old trial / "isn't active" text
      await expect(page.getByRole("status").filter({ hasText: "Free trial" })).toHaveCount(0);
      await expect(page.getByText("isn't active")).toHaveCount(0);
      const row = await subRow(B());
      expect(row.status).toBe("active");
      expect(row.extra_locations).toBe(1);
      expect(row.stripe_subscription_id).toBeTruthy();
      // the rest of the dashboard agrees without a reload
      await page.goto(`/o/${S.orgB.slug}/team`);
      await expect(page.getByRole("status").filter({ hasText: "Free trial" })).toHaveCount(0);
      await noHorizontalScroll(page);
      w.assertNone();
    });
  }

  test("backing out of Checkout returns with 'Checkout was cancelled. Nothing was charged.' and stays on the trial", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await subscribe(page).click();
    await page.waitForURL(/\/pay\/cs_mock_/);
    await page.click("#cancel");
    await page.waitForURL(/checkout=cancelled/);
    await expect(page.getByText("Checkout was cancelled. Nothing was charged.")).toBeVisible();
    await expect(page.getByText("Free trial", { exact: true }).first()).toBeVisible();
    await expect(subscribe(page)).toBeEnabled();
    expect((await subRow(B())).status).toBe("trial");
  });

  test("returning before the payment is confirmed (or with a made-up session) says it's processing and changes nothing", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    for (const sid of ["cs_mock_999999", "not-a-session", "cs_x"]) {
      await page.goto(`${url}?checkout=success&session_id=${sid}`);
      await page.waitForURL(/checkout=processing/);
      await expect(page.getByText("Payment received. Your plan will show here in a moment")).toBeVisible();
      expect((await subRow(B())).status).toBe("trial");
    }
    // an open (unpaid) session of this team is not enough either
    await openAt(page, 1280, url);
    await subscribe(page).click();
    await page.waitForURL(/\/pay\/(cs_mock_\d+)/);
    const open = page.url().match(/\/pay\/(cs_mock_\d+)/)![1];
    await page.goto(`${url}?checkout=success&session_id=${open}`);
    await page.waitForURL(/checkout=processing/);
    expect((await subRow(B())).status).toBe("trial");
  });

  test("another team's paid Checkout session can't be used to switch on this team's plan", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    await setPlan(S.orgA.id, "active", { extraLocations: 0, staffPacks: 0 });
    const b = await pageAs("ownerB");
    await openAt(b, 1280, url);
    await choose(b, 3, 3);
    await subscribe(b).click();
    await b.waitForURL(/\/pay\/(cs_mock_\d+)/);
    const sid = b.url().match(/\/pay\/(cs_mock_\d+)/)![1];
    await b.click("#pay");
    await b.waitForURL(/checkout=done/);
    const a = await pageAs("ownerA");
    await a.goto(`${billingUrl(S.orgA.slug)}?checkout=success&session_id=${sid}`);
    await a.waitForURL(/checkout=processing/);
    const rowA = await subRow(S.orgA.id);
    expect(rowA.extra_locations).toBe(0);
    expect(rowA.stripe_subscription_id).not.toBe((await subRow(B())).stripe_subscription_id);
    await setPlan(S.orgA.id, "active", { extraLocations: 3, staffPacks: 2 });
  });

  test("a team that never had a trial is told why, and the notice is the only thing the address can add", async ({ pageAs }) => {
    await setPlan(B(), "none");
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `${url}?notice=no-trial`);
    await expect(page.getByText("Your free trial was already used on another team, so this team starts without one.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
    await expect(page.getByText("Your trial has ended.")).toHaveCount(0); // that wording is for a trial that ran out
    await page.goto(`${url}?notice=<b>x</b>`);
    await expect(page.getByText("Your free trial was already used")).toHaveCount(0);
  });

  test("double-clicking Subscribe starts one Checkout, not two", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await subscribe(page).dblclick();
    await page.waitForURL(/\/pay\/cs_mock_/);
    const made = (await stripeMock.calls("/v1/checkout/sessions")).filter((c) => c.method === "POST");
    // Stripe treats the same idempotency key as the same request; the stand-in does too, so even a second call would be one session
    expect(made.length).toBeGreaterThanOrEqual(1);
    expect(new Set(made.map((c) => c.idem)).size).toBe(1);
    expect(made.every((c) => Boolean(c.idem))).toBe(true);
    expect(made.length, "the second click must not send a second request").toBe(1);
  });
});

test.describe("tampered quantities (crafted requests, not the screen)", () => {
  test("Subscribe refuses 0-less, negative, fractional, huge, text, missing and odd values without calling Stripe", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    const cap = await captureAction(page, () => subscribe(page).click());
    expect(JSON.parse(cap.body)).toEqual([S.orgB.slug, { extraLocations: 0, staffPacks: 0 }]);
    await page.waitForURL(/\/pay\/cs_mock_/);
    const before = (await stripeMock.calls("/v1/checkout/sessions")).length;
    const bad: unknown[] = [
      { extraLocations: -1, staffPacks: 0 }, { extraLocations: 0, staffPacks: -5 }, { extraLocations: 1.5, staffPacks: 0 }, { extraLocations: 0, staffPacks: 0.1 },
      { extraLocations: 21, staffPacks: 0 }, { extraLocations: 0, staffPacks: 41 }, { extraLocations: 99999999999, staffPacks: 0 }, { extraLocations: 1e21, staffPacks: 1 },
      { extraLocations: "abc", staffPacks: 0 }, { extraLocations: "1e3", staffPacks: 0 }, { extraLocations: "-1", staffPacks: 0 }, { extraLocations: "1.5", staffPacks: 0 },
      { extraLocations: "9999", staffPacks: 0 }, { extraLocations: null, staffPacks: 0 }, { extraLocations: true, staffPacks: 0 }, { extraLocations: [1], staffPacks: 0 },
      { extraLocations: { a: 1 }, staffPacks: 0 }, { extraLocations: 0 }, {}, { staffPacks: 0 }, { extraLocations: "", staffPacks: "" },
    ];
    for (const input of bad) {
      const text = await replayAction(page, cap, [S.orgB.slug, input]);
      expect(text, JSON.stringify(input)).toContain("Choose a whole number of locations and staff packs.");
      expect(text).not.toContain('"url"');
    }
    expect((await stripeMock.calls("/v1/checkout/sessions")).length, "no checkout was created for a bad quantity").toBe(before);
    expect((await subRow(B())).status).toBe("trial");
  });

  test("Update plan refuses bad quantities and a quantity string is not trusted for the price", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await choose(page, 2, 0);
    const cap = await captureAction(page, () => updatePlan(page).click());
    await expect(page.getByText("Plan updated")).toBeVisible();
    expect((await subRow(B())).extra_locations).toBe(2);
    const calls = async () => (await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST").length;
    const before = await calls();
    for (const input of [{ extraLocations: -1, staffPacks: 0 }, { extraLocations: 2.5, staffPacks: 0 }, { extraLocations: 500, staffPacks: 0 }, { extraLocations: 0, staffPacks: "x" }, {}]) {
      expect(await replayAction(page, cap, [S.orgB.slug, input]), JSON.stringify(input)).toContain("Choose a whole number of locations and staff packs.");
    }
    expect(await calls(), "Stripe was not asked to change anything").toBe(before);
    const row = await subRow(B());
    expect(row.extra_locations).toBe(2);
    expect(row.staff_packs).toBe(0);
  });
});

test.describe("an active plan", () => {
  for (const width of WIDTHS) {
    test(`plan summary, next invoice, usage and every section at ${width}px`, async ({ pageAs }) => {
      await setPlan(B(), "active", { extraLocations: 2, staffPacks: 2 });
      const page = await pageAs("ownerB");
      const w = watchErrors(page);
      await openAt(page, width, url);
      await expect(page.getByText("3 locations, 25 staff", { exact: true })).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
      await expect(page.getByText("$55/month", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/Next invoice:\s*\$55 on /)).toBeVisible();
      await expect(page.getByText("(before any tax)")).toBeVisible();
      await expect(page.getByText("0 of 3")).toBeVisible();
      await expect(page.getByText("1 of 25")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Change your plan" })).toBeVisible();
      await expect(extraLocationsInput(page)).toHaveValue("2");
      await expect(staffPacksInput(page)).toHaveValue("2");
      await expect(updatePlan(page)).toBeDisabled(); // nothing changed yet
      await expect(page.getByText("Upgrades are charged now for the rest of this billing period.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Card and invoices" })).toBeVisible();
      await expect(manage(page)).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Cancel subscription" })).toBeVisible();
      await expect(cancelBtn(page)).toHaveText("Cancel at period end");
      await expect(subscribe(page)).toHaveCount(0);
      await noHorizontalScroll(page);
      w.assertNone();
    });
  }

  test("changing the plan up: price updates live, Stripe is asked to charge the prorated amount now, the page shows the new plan", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await choose(page, 2, 1);
    await expect(liveTotal(page)).toContainText("$50");
    await expect(updatePlan(page)).toBeEnabled();
    await updatePlan(page).click();
    await expect(page.getByText("Plan updated")).toBeVisible();
    await expect(page.getByText("3 locations, 20 staff", { exact: true })).toBeVisible();
    await expect(page.getByText("$50/month", { exact: true }).first()).toBeVisible();
    await expect(updatePlan(page)).toBeDisabled();
    const [upd] = (await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST");
    expect(upd.body.proration_behavior).toBe("always_invoice");
    expect(upd.body.payment_behavior).toBe("error_if_incomplete");
    const row = await subRow(B());
    expect([row.extra_locations, row.staff_packs]).toEqual([2, 1]);
    // the owner is emailed about it
    await expect.poll(async () => (await mock.sent()).emails.some((e) => /plan was updated/i.test(e.subject))).toBe(true);
  });

  test("changing the plan down is credited on the next invoice, and is refused while usage is above the new limit", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 2 }); // 15 staff
    const db = await admin();
    for (let i = 1; i <= 7; i++) await db.from("memberships").insert({ org_id: B(), user_id: null, role: "member", display_name: `E2E Helper ${i}` });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.getByText("8 of 15")).toBeVisible();
    // 8 people don't fit 5 staff (0 packs) -> blocked with the reason, button off
    await choose(page, 0, 0);
    await expect(page.getByText("You have 8 team members but this plan includes 5. Remove 3 team members first, or keep more staff packs.")).toBeVisible();
    await expect(updatePlan(page)).toBeDisabled();
    // 1 pack = 10 staff fits 8 people
    await choose(page, 0, 1);
    await expect(page.getByText("but this plan includes")).toHaveCount(0);
    await expect(updatePlan(page)).toBeEnabled();
    await updatePlan(page).click();
    await expect(page.getByText("Plan updated")).toBeVisible();
    const [upd] = (await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST");
    expect(upd.body.proration_behavior).toBe("create_prorations");
    expect(upd.body.payment_behavior).toBeUndefined();
    expect((await subRow(B())).staff_packs).toBe(1);
    // a crafted request for the blocked plan is refused by the server too
    const cap = await captureAction(page, async () => { await choose(page, 0, 2); await updatePlan(page).click(); });
    expect(await replayAction(page, cap, [S.orgB.slug, { extraLocations: 0, staffPacks: 0 }])).toContain("You have 8 team members but this plan includes 5.");
    await expect.poll(async () => (await subRow(B())).staff_packs).toBe(2); // the real click went through; the crafted one did not
  });

  test("a location in use blocks removing locations, with a clear message", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 2, staffPacks: 0 });
    const db = await admin();
    for (const n of ["E2E Loc 1", "E2E Loc 2", "E2E Loc 3"]) await db.from("locations").insert({ org_id: B(), name: n });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.getByText("3 of 3")).toBeVisible();
    await choose(page, 0, 0);
    await expect(page.getByText("You use 3 locations but this plan includes 1. Deactivate or delete 2 locations first.")).toBeVisible();
    await expect(updatePlan(page)).toBeDisabled();
  });

  test("unchanged, or a plan the stand-in Stripe already has, changes nothing", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await choose(page, 1, 0);
    await expect(updatePlan(page)).toBeDisabled();
    await choose(page, 2, 0);
    await expect(updatePlan(page)).toBeEnabled();
    await choose(page, 1, 0);
    await expect(updatePlan(page)).toBeDisabled();
  });
});

test.describe("cancel at the end of the period, and resume", () => {
  test("the cancel button needs a second press; a fast double-click does not confirm it (D-008); it disarms itself", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    const btn = cancelBtn(page);
    await expect(btn).toHaveText("Cancel at period end");
    await btn.click();
    await expect(btn).toHaveText("Tap again to confirm");
    expect((await subRow(B())).cancel_at_period_end).toBe(false);
    // it disarms itself after about 6 seconds
    await expect(btn).toHaveText("Cancel at period end", { timeout: 12_000 });
    // fast double click: the second click comes inside 0.8 s and must not confirm
    await btn.dblclick();
    await expect(btn).toHaveText("Tap again to confirm");
    expect((await subRow(B())).cancel_at_period_end).toBe(false);
    expect((await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST")).toHaveLength(0);
    // a deliberate second press (retry until the 0.8 s guard has passed) confirms
    await expect(async () => {
      await btn.click({ timeout: 1000 });
      await expect(page.getByText("Subscription will end at the period end")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 8000 });
    await expect(page.getByText("Your plan is cancelled. Everything keeps working until")).toBeVisible();
    await expect(page.getByText(/^Ends /)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your plan ends on" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cancel subscription" })).toHaveCount(0);
    await expect(page.getByText(/Next invoice:/)).toHaveCount(0);
    expect((await subRow(B())).cancel_at_period_end).toBe(true);
    const [upd] = (await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST");
    expect(upd.body.cancel_at_period_end).toBe("true");

    // resume
    await page.getByRole("button", { name: "Keep my subscription" }).click();
    await expect(page.getByText("Subscription resumed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep my subscription" })).toHaveCount(0);
    await expect(cancelBtn(page)).toHaveText("Cancel at period end");
    await expect(page.getByText(/Next invoice:/)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your plan ends on" })).toHaveCount(0);
    expect((await subRow(B())).cancel_at_period_end).toBe(false);
  });

  for (const width of [375, 768] as const) {
    test(`cancel and resume work at ${width}px`, async ({ pageAs }) => {
      await setPlan(B(), "active", { cancelAtPeriodEnd: true, periodDays: 9 });
      const page = await pageAs("ownerB");
      await openAt(page, width, url);
      await expect(page.getByRole("button", { name: "Keep my subscription" })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Your plan ends on" })).toBeVisible();
      await noHorizontalScroll(page);
      await page.getByRole("button", { name: "Keep my subscription" }).click();
      await expect(page.getByText("Subscription resumed")).toBeVisible();
    });
  }
});

test.describe("Manage billing", () => {
  test("opens the stand-in Customer Portal with Tempo's own configuration and comes back to the billing page", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await manage(page).click();
    await page.waitForURL(/127\.0\.0\.1:4010\/portal\/cus_e2e_/);
    const [call] = await stripeMock.calls("/v1/billing_portal/sessions");
    expect(call.body.configuration).toMatch(/^bpc_/);
    expect(call.body.return_url).toContain(url);
    await page.click("#back");
    await page.waitForURL(`**${url}`);
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  });

  test("a trial team without a Stripe customer has no Manage billing button", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(manage(page)).toHaveCount(0);
  });

  test("a cancelled plan that still has a Stripe customer keeps Manage billing (invoices) and offers Subscribe", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 0 });
    const db = await admin();
    await db.from("subscriptions").update({ status: "cancelled", stripe_subscription_id: null, cancel_at_period_end: false }).eq("org_id", B());
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByText("No active plan.")).toBeVisible();
    await expect(manage(page)).toBeEnabled();
    await expect(subscribe(page)).toBeVisible();
    await expect(page.getByText("Your booking page is paused and the dashboard is read-only.")).toBeVisible();
    await expect(cancelBtn(page)).toHaveCount(0);
  });
});

test.describe("subscribing when the plan is off", () => {
  test("a team with no trial and no plan sees 'Choose a plan', the paused notice and a working Subscribe", async ({ pageAs }) => {
    await setPlan(B(), "trial-ended");
    const page = await pageAs("ownerB");
    await openAt(page, 375, url);
    await expect(page.getByText("Your trial has ended.")).toBeVisible(); // D-023: this used to expect "No active plan." (the trial copy was unreachable)
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect(page.getByText("Your booking page is paused and the dashboard is read-only. You can still view and export everything")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your plan isn't active." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("Subscribe is disabled while the team uses more than the chosen plan includes (and works once it fits)", async ({ pageAs }) => {
    // people can only be added while a plan is on: add them, then switch the plan off
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 2 });
    const db = await admin();
    for (let i = 1; i <= 6; i++) await db.from("memberships").insert({ org_id: B(), user_id: null, role: "member", display_name: `E2E Helper ${i}` });
    await setPlan(B(), "trial-ended");
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.getByText("7 of 5")).toBeVisible();
    await expect(subscribe(page)).toBeDisabled();
    await expect(page.getByText(/You have 7 team members but this plan includes 5\. Remove 2 team members/)).toBeVisible();
    await choose(page, 0, 1); // 10 staff
    await expect(subscribe(page)).toBeEnabled();
    await expect(page.getByText("but this plan includes")).toHaveCount(0);
    await choose(page, 0, 0);
    await expect(subscribe(page)).toBeDisabled();
  });
});
