// Error paths of the billing screens: Stripe failing (Checkout, Portal, plan change, cancel, add-on), raw Stripe text never reaching
// the browser (S-005), an unpaid or already-existing subscription, billing not set up / no portal configuration (a second copy of
// the server with different settings), a lost connection, a server error and an expired session.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S, mock, watchErrors } from "./helpers";
import {
  A, B, admin, billingUrl, bodyText, captureAction, choose, noHorizontalScroll, openAt, removeExtras, replayAction, restoreSeedPlans, setPlan, startSecondServer, stripeMock, subRow,
} from "./billing-helpers";

const url = billingUrl(S.orgB.slug);
const GENERIC = "Something went wrong with billing. Please try again in a moment.";
const LEAK = /sk_test|price_mock|No such price|req_mockLEAK|mock raw stripe|invalid_request_error|StripeInvalid/i;
const subscribe = (page: Page) => page.getByRole("button", { name: /^Subscribe for/ });
const updatePlan = (page: Page) => page.getByRole("button", { name: "Update plan" });
const manage = (page: Page) => page.getByRole("button", { name: "Manage billing", exact: true });
const cancelBtn = (page: Page) => page.getByRole("button", { name: /Cancel at period end|Tap again to confirm/ });
async function confirmCancel(page: Page) {
  const btn = cancelBtn(page);
  await btn.click();
  await expect(btn).toHaveText("Tap again to confirm");
}

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(B()); await removeExtras(A()); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

test.describe("Stripe says no", () => {
  test("Checkout fails: the friendly sentence, never Stripe's text, and Subscribe works again once Stripe recovers", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    const w = watchErrors(page);
    await openAt(page, 375, url);
    await stripeMock.mode({ checkout: "fail" });
    await subscribe(page).click();
    await expect(page.getByText(GENERIC)).toBeVisible();
    expect(await bodyText(page)).not.toMatch(LEAK);
    await expect(subscribe(page)).toBeEnabled();
    await noHorizontalScroll(page);
    expect(page.url()).not.toContain("/pay/");
    await stripeMock.mode({ checkout: "ok" });
    await subscribe(page).click();
    await page.waitForURL(/\/pay\/cs_mock_/);
    w.assertNone();
  });

  test("Portal fails: the same friendly sentence", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await stripeMock.mode({ portal: "fail" });
    await manage(page).click();
    await expect(page.getByText(GENERIC)).toBeVisible();
    expect(await bodyText(page)).not.toMatch(LEAK);
    await expect(manage(page)).toBeEnabled();
    expect(page.url()).toContain("/settings/billing");
  });

  test("plan change fails: a plain message, the plan is unchanged, no Stripe text", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await choose(page, 1, 0);
    await stripeMock.mode({ subupdate: "fail" });
    await updatePlan(page).click();
    await expect(page.getByText("Stripe couldn't change your plan just now. Please try again in a moment.")).toBeVisible();
    expect(await bodyText(page)).not.toMatch(LEAK);
    expect((await subRow(B())).extra_locations).toBe(0);
    await expect(updatePlan(page)).toBeEnabled();
    await stripeMock.mode({ subupdate: "ok" });
    await updatePlan(page).click();
    await expect(page.getByText("Plan updated")).toBeVisible();
    await expect(page.getByText("Stripe couldn't change your plan")).toHaveCount(0);
    expect((await subRow(B())).extra_locations).toBe(1);
  });

  test("a declined card on an upgrade says so and points to Manage billing", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await choose(page, 0, 2);
    await stripeMock.mode({ subupdate: "card" });
    await updatePlan(page).click();
    await expect(page.getByText("The card on file was declined, so your plan wasn't changed. Update your card from Manage billing and try again.")).toBeVisible();
    expect(await bodyText(page)).not.toMatch(LEAK);
    expect((await subRow(B())).staff_packs).toBe(0);
  });

  test("cancel and resume fail: a plain message each, nothing changes", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await stripeMock.mode({ subupdate: "fail" });
    await confirmCancel(page);
    await expect(async () => {
      await cancelBtn(page).click({ timeout: 1000 });
      await expect(page.getByText("Stripe couldn't update your subscription just now. Please try again in a moment.")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 10_000 });
    expect(await bodyText(page)).not.toMatch(LEAK);
    expect((await subRow(B())).cancel_at_period_end).toBe(false);
    // resume
    await stripeMock.mode({ subupdate: "ok" });
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0, cancelAtPeriodEnd: true });
    await page.goto(url);
    await stripeMock.mode({ subupdate: "fail" });
    await page.getByRole("button", { name: "Keep my subscription" }).click();
    await expect(page.getByText("Stripe couldn't update your subscription just now. Please try again in a moment.")).toBeVisible();
    expect(await bodyText(page)).not.toMatch(LEAK);
    expect((await subRow(B())).cancel_at_period_end).toBe(true);
  });

  test("the one-click add-on fails: the prompt shows the plain message and the person is not added", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const db = await admin();
    for (let i = 1; i <= 4; i++) await db.from("memberships").insert({ org_id: B(), user_id: null, role: "member", display_name: `E2E Helper ${i}` });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, `/o/${S.orgB.slug}/team`);
    await page.getByRole("button", { name: "Add team member" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill("E2E Sixth");
    await dlg.getByRole("button", { name: "Add team member" }).click();
    await stripeMock.mode({ subupdate: "fail" });
    await dlg.getByRole("alert").getByRole("button", { name: /Add and continue/ }).click();
    await expect(dlg.getByRole("alert")).toContainText("Stripe couldn't change your plan just now. Please try again in a moment.");
    expect(await bodyText(page)).not.toMatch(LEAK);
    expect((await db.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", B())).count).toBe(5);
    expect((await subRow(B())).staff_packs).toBe(0);
  });
});

test.describe("subscriptions that already exist at Stripe", () => {
  test("an unpaid subscription past the grace period: Subscribe explains it and offers 'Open Manage billing'", async ({ pageAs }) => {
    await setPlan(B(), "past-due", { daysAgo: 9, extraLocations: 0, staffPacks: 0 });
    await (await admin()).from("subscriptions").update({ status: "expired" }).eq("org_id", B());
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Manage billing" })).toHaveCount(0); // only after a refusal
    await subscribe(page).click();
    await expect(page.getByText(/Your subscription still exists at Stripe but has an unpaid invoice/)).toBeVisible();
    const portal = page.getByRole("button", { name: "Open Manage billing" });
    await expect(portal).toBeEnabled();
    expect((await stripeMock.calls("/v1/checkout/sessions")).length).toBe(0);
    await portal.click();
    await page.waitForURL(/\/portal\/cus_e2e_/);
    expect((await subRow(B())).status).toBe("expired");
  });

  test("Stripe already has a healthy subscription our copy missed: Subscribe says so, brings our copy up to date, no second checkout", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 1, staffPacks: 0 });
    await (await admin()).from("subscriptions").update({ status: "trial", trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), stripe_subscription_id: null, current_period_end: null, extra_locations: 0 }).eq("org_id", B());
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await subscribe(page).click();
    await expect(page.getByText("You already have a subscription. Refresh this page to see it, then use Change plan.")).toBeVisible();
    expect((await stripeMock.calls("/v1/checkout/sessions")).filter((c) => c.method === "POST")).toHaveLength(0);
    await page.reload();
    await expect(page.getByText("2 locations, 10 staff", { exact: true }).first()).toBeVisible();
    await expect(updatePlan(page)).toBeVisible();
    await expect(subscribe(page)).toHaveCount(0);
  });
});

test.describe("billing is not set up on the server", () => {
  let second: { base: string; stop: () => Promise<void> };
  test.afterEach(async () => { await second?.stop(); });

  test("no portal configuration: 'Billing portal isn't set up yet' and Stripe is not called", async ({ pageAs }) => {
    second = await startSecondServer(3001, { STRIPE_PORTAL_CONFIGURATION: "" });
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    const page = await pageAs("ownerB");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${second.base}${url}`);
    await expect(manage(page)).toBeEnabled();
    await manage(page).click();
    await expect(page.getByText("Billing portal isn't set up yet. Please contact support.")).toBeVisible();
    expect(await bodyText(page)).not.toMatch(LEAK);
    expect((await stripeMock.calls("/v1/billing_portal/sessions")).length).toBe(0);
    // the rest of the page still works on that server
    await expect(updatePlan(page)).toBeDisabled();
    await expect(cancelBtn(page)).toBeEnabled();
  });

  test("no Stripe prices: the page says billing isn't set up, every billing button is off, and a crafted request is refused", async ({ pageAs }) => {
    second = await startSecondServer(3002, { STRIPE_PRICE_BASE: "" });
    // first capture an action id on the main server
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    const cap = await captureAction(page, () => subscribe(page).click());
    await page.waitForURL(/\/pay\//);
    await page.goto(`${second.base}${url}`);
    await expect(page.getByText("Billing isn't set up on this server yet, so plans can't be changed.")).toBeVisible();
    await expect(subscribe(page)).toBeDisabled();
    const before = (await stripeMock.calls("/v1/checkout/sessions")).length;
    const res = await page.request.post(`${second.base}${new URL(cap.url).pathname}`, {
      headers: { "next-action": cap.headers["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" },
      data: JSON.stringify([S.orgB.slug, { extraLocations: 0, staffPacks: 0 }]),
    });
    expect(await res.text()).toContain("Billing isn't set up on this server yet.");
    expect((await stripeMock.calls("/v1/checkout/sessions")).length).toBe(before);
    // an active team: change plan, Manage billing and cancel are all disabled
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    await page.goto(`${second.base}${url}`);
    await expect(updatePlan(page)).toBeDisabled();
    await expect(manage(page)).toBeDisabled();
    await expect(cancelBtn(page)).toBeDisabled();
  });
});

test.describe("the connection, the server and the session", () => {
  test("D-020 the request is lost on the way: the page stays usable (no crash) and Subscribe can be pressed again", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    let blocked = true;
    await page.route("**/*", async (route) => {
      const r = route.request();
      if (blocked && r.method() === "POST" && r.headers()["next-action"]) return route.abort("connectionfailed");
      return route.continue();
    });
    await subscribe(page).click();
    // whatever the message, the screen is still the billing page and the button comes back
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong!/i);
    await expect(subscribe(page)).toBeEnabled();
    blocked = false;
    await subscribe(page).click();
    await page.waitForURL(/\/pay\/cs_mock_/);
  });

  test("D-020 the server answers 500: the page stays usable", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 12 });
    const page = await pageAs("ownerB");
    await openAt(page, 1280, url);
    await page.route("**/*", async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
      return route.continue();
    });
    await subscribe(page).click();
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Application error/i);
    await expect(subscribe(page)).toBeEnabled();
  });

  test("D-020 the session ends while the page is open: pressing a billing button sends the person to sign in, and no Stripe call is made", async ({ pageAs, browser }) => {
    await setPlan(B(), "trial", { days: 12 });
    // use a private context so the shared session of other tests is not lost
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const { login } = await import("./helpers");
    await login(page, "ownerB");
    await openAt(page, 1280, url);
    await ctx.clearCookies();
    await subscribe(page).click();
    await page.waitForURL(/\/login/);
    expect((await stripeMock.calls("/v1/checkout/sessions")).length).toBe(0);
    await ctx.close();
  });

  test("the billing page for a team whose subscription record can't be read says so instead of crashing", async ({ pageAs }) => {
    const db = await admin();
    const row = await subRow(B());
    await db.from("subscriptions").delete().eq("org_id", B());
    try {
      const page = await pageAs("ownerB");
      const res = await page.goto(url);
      expect(res!.status()).toBe(200);
      await expect(page.getByText("We couldn't load your subscription. Please try again in a moment.")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/Application error/i);
    } finally {
      const { error } = await db.from("subscriptions").insert({ org_id: B(), status: "trial", trial_ends_at: row.trial_ends_at });
      expect(error, error?.message).toBeNull();
    }
  });
});
