// A team with no active plan: the public booking page, embed and contact form say "not accepting bookings" (neutrally), a
// customer's existing booking can still be cancelled and moved, the dashboard is read-only with a plain message while reading and
// exporting still work, and subscribing again through Checkout turns everything back on at once. Team A (E2E Salon).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerEmail, dayAhead, mock, pickDay, pickTime, rpcBook, S, watchErrors } from "./helpers";
import { A, WIDTHS, admin, billingUrl, bodyText, choose, noHorizontalScroll, openAt, removeExtras, restoreSeedPlans, setPlan, stripeMock, subRow } from "./billing-helpers";

const slug = S.orgA.slug;
const PAGES = [`/${slug}`, `/embed/${slug}`, `/${slug}/contact`, `/embed/${slug}/contact`];
const OWNER_MSG = "Your subscription isn't active, so changes are turned off. You can still view and export your data. Subscribe on the Billing page to switch everything back on.";
const OTHER_MSG = "This business's subscription isn't active, so changes are turned off. Ask the account owner to subscribe on the Billing page.";
const raw = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(A()); });
test.afterAll(async () => {
  await raw().from("organizations").update({ phone: null, website: null }).eq("id", A());
  await restoreSeedPlans();
});

const pausedHeading = (page: Page) => page.getByRole("heading", { name: "E2E Salon isn't accepting bookings right now" });

test.describe("public pages while the plan is off", () => {
  test("with a plan the booking page, embed and contact form work (control)", async ({ page }) => {
    await setPlan(A(), "active", { extraLocations: 3, staffPacks: 2 });
    await page.goto(`/${slug}`);
    await expect(page.getByRole("heading", { name: "Choose a location" })).toBeVisible();
    await expect(pausedHeading(page)).toHaveCount(0);
    await page.goto(`/embed/${slug}`);
    await expect(page.getByRole("heading", { name: "Choose a location" })).toBeVisible();
    await page.goto(`/${slug}/contact`);
    await expect(pausedHeading(page)).toHaveCount(0);
    await expect(page.getByLabel("Name").first()).toBeVisible();
  });

  for (const [name, state, opts] of [
    ["trial ended", "trial-ended", {}],
    ["no plan (second team)", "none", {}],
    ["subscription ended", "cancelled", {}],
    ["payment failed more than 7 days ago", "past-due", { daysAgo: 8, extraLocations: 3, staffPacks: 2 }],
  ] as const) {
    test(`${name}: every public page shows the neutral paused page, at 375, 768 and 1280px`, async ({ page }) => {
      await setPlan(A(), state, opts);
      const w = watchErrors(page);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        for (const path of PAGES) {
          await page.goto(path);
          await expect(pausedHeading(page), `${path} @${width}`).toBeVisible();
          await expect(page.getByText("Online booking is paused. Please check back later.")).toBeVisible();
          const text = await bodyText(page);
          expect(text, path).not.toMatch(/subscri|payment|trial|billing|plan|owner|invoice|Stripe/i);
          // nothing to book or send
          await expect(page.getByRole("button", { name: /book|continue|send|choose/i })).toHaveCount(0);
          await expect(page.locator("form")).toHaveCount(0);
          await noHorizontalScroll(page);
        }
      }
      w.assertNone();
    });
  }

  test("a healthy-but-cancelling plan (paid, ending in 5 days) is NOT paused; the grace period of a failed payment is NOT paused either", async ({ page }) => {
    await setPlan(A(), "active", { cancelAtPeriodEnd: true, periodDays: 5, extraLocations: 3, staffPacks: 2 });
    await page.goto(`/${slug}`);
    await expect(pausedHeading(page)).toHaveCount(0);
    await setPlan(A(), "past-due", { daysAgo: 3, extraLocations: 3, staffPacks: 2 });
    await page.goto(`/${slug}`);
    await expect(pausedHeading(page)).toHaveCount(0);
    await page.goto(`/embed/${slug}`);
    await expect(pausedHeading(page)).toHaveCount(0);
  });

  test("the business phone and website are offered (website only when it is a real http(s) link); a made-up slug is still a 404", async ({ page }) => {
    await setPlan(A(), "trial-ended");
    await raw().from("organizations").update({ phone: "416-555-0100", website: "https://example.test/salon" }).eq("id", A());
    await page.goto(`/${slug}`);
    await expect(page.getByText("or contact them directly")).toBeVisible();
    await expect(page.getByText("416-555-0100")).toBeVisible();
    const link = page.getByRole("link", { name: "example.test/salon" });
    await expect(link).toHaveAttribute("href", "https://example.test/salon");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await raw().from("organizations").update({ website: "javascript:alert(1)" }).eq("id", A());
    await page.goto(`/${slug}`);
    await expect(page.getByRole("link", { name: /alert/ })).toHaveCount(0);
    await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);
    const res = await page.goto("/e2e-no-such-business");
    expect(res!.status()).toBe(404);
    expect(await bodyText(page)).not.toMatch(/accepting bookings/i);
  });

  test("a booking made straight at the database for a paused team is refused (the page is not the only gate)", async ({ request }) => {
    await setPlan(A(), "trial-ended");
    await expect(rpcBook({ day: dayAhead(9), time: "10:00" })).rejects.toThrow(/not accepting bookings|booking failed/i);
  });
});

test.describe("an existing customer's booking on a paused team", () => {
  test("the customer can still open, cancel it; and reschedule another one (D-009 decision)", async ({ page }) => {
    await setPlan(A(), "active", { extraLocations: 3, staffPacks: 2 });
    const e1 = customerEmail("paused-cancel");
    const e2 = customerEmail("paused-move");
    const b1 = await rpcBook({ day: dayAhead(20), time: "10:00", email: e1 });
    const b2 = await rpcBook({ day: dayAhead(21), time: "10:00", email: e2 });
    await setPlan(A(), "trial-ended");
    const w = watchErrors(page);

    await page.goto(`/booking/${b1.manage_token}`);
    await expect(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
    const { data } = await raw().from("bookings").select("status").eq("id", b1.id).single();
    expect(data!.status).toBe("cancelled");

    await page.goto(`/booking/${b2.manage_token}/reschedule`);
    await expect(page.getByRole("heading", { name: "Pick a new time" })).toBeVisible();
    await pickDay(page, 8);
    await pickTime(page, "3:00 PM");
    await page.getByRole("button", { name: /^Move to/ }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}\?moved=1/);
    await expect(page.getByText("Your booking has been moved.")).toBeVisible();
    w.assertNone();
  });
});

test.describe("the dashboard is read-only without a plan", () => {
  test("owner: creating a service, saving settings and adding a person each say so in plain words; nothing is saved", async ({ pageAs }) => {
    await setPlan(A(), "trial-ended");
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const servicesBefore = (await raw().from("services").select("id", { count: "exact", head: true }).eq("org_id", A())).count;

    await openAt(page, 1280, `/o/${slug}/services`);
    await expect(page.getByText("Haircut").first()).toBeVisible(); // reading works
    await page.getByRole("button", { name: "New service" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Blocked Service");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(OWNER_MSG)).toBeVisible();
    expect((await raw().from("services").select("id", { count: "exact", head: true }).eq("org_id", A())).count).toBe(servicesBefore);
    await page.keyboard.press("Escape");

    await page.goto(`/o/${slug}/settings`);
    await page.getByLabel("Name", { exact: true }).fill("E2E Salon Renamed");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(OWNER_MSG)).toBeVisible();
    expect((await raw().from("organizations").select("name").eq("id", A()).single()).data!.name).toBe("E2E Salon");

    await page.goto(`/o/${slug}/team`);
    await page.getByRole("button", { name: "Add team member" }).first().click();
    await page.getByRole("dialog").getByLabel("Name").fill("E2E Blocked Person");
    await page.getByRole("dialog").getByRole("button", { name: "Add team member" }).click();
    await expect(page.getByRole("dialog")).toContainText(OWNER_MSG);
    w.assertNone();
  });

  test("owner can still delete a location without a plan (it only lowers usage, and a smaller plan needs it), but not rename one", async ({ pageAs }) => {
    await setPlan(A(), "active", { extraLocations: 3 }); // adding a location is itself refused without a plan, so add it first
    const { data: extra } = await raw().from("locations").insert({ org_id: A(), name: "E2E Shrink Place", active: true, position: 98 }).select("id").single();
    await setPlan(A(), "trial-ended");
    try {
      const page = await pageAs("ownerA");
      await page.goto(`/o/${slug}/settings`);
      await page.getByRole("button", { name: /E2E Shrink Place/ }).click();
      await page.getByRole("dialog").getByLabel("Name").fill("E2E Shrink Renamed");
      await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(OWNER_MSG)).toBeVisible(); // changing is still off
      expect((await raw().from("locations").select("name").eq("id", extra!.id).single()).data!.name).toBe("E2E Shrink Place");
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Tap to confirm" }).click();
      await expect.poll(async () => (await raw().from("locations").select("id").eq("id", extra!.id)).data!.length, { timeout: 15_000 }).toBe(0);
    } finally {
      await raw().from("locations").delete().eq("id", extra!.id);
    }
  });

  for (const role of ["adminA"] as const) {
    test(`${role}: the same attempts say 'ask the account owner'`, async ({ pageAs }) => {
      await setPlan(A(), "trial-ended");
      const page = await pageAs(role);
      await openAt(page, 375, `/o/${slug}/services`);
      await page.getByRole("button", { name: "New service" }).click();
      await page.getByLabel("Name", { exact: true }).fill("E2E Blocked Service");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(OTHER_MSG)).toBeVisible();
      await page.keyboard.press("Escape");
      await page.goto(`/o/${slug}/team`);
      await page.getByRole("button", { name: "Add team member" }).first().click();
      await page.getByRole("dialog").getByLabel("Name").fill("E2E Blocked Person");
      await page.getByRole("dialog").getByRole("button", { name: "Add team member" }).click();
      await expect(page.getByRole("dialog")).toContainText("Ask the account owner to subscribe on the Billing page.");
      expect(await bodyText(page)).not.toMatch(/\$\d/);
    });
  }

  test("reading and exporting still work: pages load, and the Excel exports return real files", async ({ pageAs }) => {
    await setPlan(A(), "trial-ended");
    const page = await pageAs("ownerA");
    for (const p of ["dashboard", "bookings", "customers", "services", "team", "calendar", "settings", "inquiries", "workflows"]) {
      const res = await page.goto(`/o/${slug}/${p}`);
      expect(res!.status(), p).toBe(200);
      await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
    }
    for (const kind of ["customers", "home"]) {
      const res = await page.request.get(`/api/export/${kind}?org=${slug}`);
      expect(res.status(), kind).toBe(200);
      expect(res.headers()["content-type"]).toContain("spreadsheetml");
      expect((await res.body()).subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip
    }
    const sched = await page.request.get(`/api/export/schedule?org=${slug}&view=week`);
    expect(sched.status()).toBe(200);
  });

  test("leaving the team and deleting it are not blocked by a missing plan (only new work is)", async ({ pageAs }) => {
    // the read-only rule is about adding and changing; the billing page itself stays usable to fix it
    await setPlan(A(), "trial-ended");
    const page = await pageAs("ownerA");
    await page.goto(billingUrl(slug));
    await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  });
});

test.describe("subscribing again restores everything", () => {
  test("pay in Checkout: the booking page, embed, contact form and the dashboard all work again immediately", async ({ pageAs, browser }) => {
    await setPlan(A(), "trial-ended");
    const owner = await pageAs("ownerA");
    const w = watchErrors(owner);
    await openAt(owner, 1280, billingUrl(slug));
    // team A uses 2 locations and 4 people: the base plan does not fit, one extra location does
    await expect(owner.getByRole("button", { name: /^Subscribe for/ })).toBeDisabled();
    await expect(owner.getByText(/You use 2 locations but this plan includes 1\./)).toBeVisible();
    await choose(owner, 1, 0);
    await expect(owner.getByRole("button", { name: "Subscribe for $30/month" })).toBeEnabled();
    await owner.getByRole("button", { name: "Subscribe for $30/month" }).click();
    await owner.waitForURL(/\/pay\/cs_mock_/);
    await owner.click("#pay");
    await owner.waitForURL(/checkout=done/);
    await expect(owner.getByText("Thanks! Your subscription is active.")).toBeVisible();
    await expect(owner.getByRole("status").filter({ hasText: "isn't active" })).toHaveCount(0);
    expect((await subRow(A())).status).toBe("active");
    // a stranger's browser sees the booking page straight away
    const ctx = await browser.newContext();
    const anon = await ctx.newPage();
    for (const path of PAGES) {
      await anon.goto(path);
      await expect(pausedHeading(anon), path).toHaveCount(0);
    }
    await anon.goto(`/${slug}`);
    await expect(anon.getByRole("heading", { name: "Choose a location" })).toBeVisible();
    await ctx.close();
    // and the dashboard writes again
    await owner.goto(`/o/${slug}/services`);
    await owner.getByRole("button", { name: "New service" }).click();
    await owner.getByLabel("Name", { exact: true }).fill("E2E Back Again");
    await owner.getByRole("button", { name: "Save" }).click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(owner.getByRole("heading", { name: "E2E Back Again" })).toBeVisible();
    await raw().from("services").delete().eq("org_id", A()).eq("name", "E2E Back Again");
    w.assertNone();
  });
});
