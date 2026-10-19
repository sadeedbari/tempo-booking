import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, mock, pickDay, pickTime, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
const base = `/o/${slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const COLOUR = S.orgA.services.colour;
const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;

test.beforeEach(async () => {
  await mock.clear();
  await sb().from("services").update({ allow_series: true, auto_approve: true }).eq("id", COLOUR);
  await sb().from("time_off").delete().eq("org_id", S.orgA.id);
});

/** The booking form for Colour (Sara only) up to the details step. Each test uses its own days so series never collide. */
async function toDetails(page: import("@playwright/test").Page, nth: number, url = `/${slug}?service=colour`) {
  await page.goto(url);
  await page.getByRole("button", { name: /Queen West/ }).click();
  const label = await pickDay(page, nth);
  await pickTime(page, "10:00 AM");
  return label;
}
const seriesOf = async (email: string) => {
  const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
  const { data } = await sb().from("bookings").select("id, starts_at, status, series_id, series_index, manage_token").eq("customer_id", cust!.id).order("starts_at");
  return data ?? [];
};

test.describe("the service setting", () => {
  test("a business switches repeating appointments on and off per service, and it needs automatic approval", async ({ pageAs }) => {
    await sb().from("services").update({ allow_series: false }).eq("id", COLOUR);
    const page = await pageAs("ownerA");
    await page.goto(`${base}/services`);
    await page.getByRole("heading", { name: "Colour", exact: true }).locator("xpath=ancestor::div[contains(@class,'group')][1]").getByRole("button", { name: "Edit" }).click(); // Colour
    const dlg = page.getByRole("dialog");
    const sw = dlg.getByRole("switch", { name: "Customers can book repeating appointments" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Service updated")).toBeVisible();
    expect((await sb().from("services").select("allow_series").eq("id", COLOUR).single()).data!.allow_series).toBe(true);

    // turning approval off disables it, and saving can't leave it on
    await page.getByRole("heading", { name: "Colour", exact: true }).locator("xpath=ancestor::div[contains(@class,'group')][1]").getByRole("button", { name: "Edit" }).click();
    await dlg.getByRole("switch", { name: "Automatically approve bookings" }).click();
    await expect(dlg.getByText(/Needs automatic approval/)).toBeVisible();
    await expect(sw).toBeDisabled();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await sb().from("services").select("allow_series, auto_approve").eq("id", COLOUR).single()).data, { timeout: 15_000 }).toEqual({ allow_series: false, auto_approve: false });
    await sb().from("services").update({ auto_approve: true }).eq("id", COLOUR);
  });
});

test.describe("booking a repeating appointment online", () => {
  test("choose a repeat, see the dates, confirm: every date is booked and the customer gets one email listing them", async ({ page }) => {
    const w = watchErrors(page);
    await toDetails(page, 3);
    const box = page.getByTestId("repeat-options");
    await expect(box.getByText("Repeat this appointment")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm booking" })).toBeVisible();

    await box.getByLabel("How often").selectOption({ label: "Every week" });
    await box.getByLabel("How many appointments").selectOption({ label: "3 appointments" });
    const dates = box.getByRole("list", { name: "Dates" }).getByRole("listitem");
    await expect(dates).toHaveCount(3);
    await expect(box.getByText(/Not available/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm 3 appointments" })).toBeVisible();

    const email = customerEmail("series");
    await fillDetails(page, { name: "Sera Series", email });
    await page.getByRole("button", { name: "Confirm 3 appointments" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);

    // the manage page shows the whole series, with this booking as the first
    const card = page.getByTestId("series-card");
    await expect(card.getByText("Repeating appointment")).toBeVisible();
    await expect(card.getByText("1 of 3 · every week")).toBeVisible();
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card.getByText("This one")).toBeVisible();

    const rows = await seriesOf(email);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.series_id)).size).toBe(1);
    expect(rows.map((r) => r.series_index)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.status === "confirmed")).toBe(true);

    // exactly one confirmation, listing every date; reminders are separate and not sent yet
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const mails = (await mock.sent()).emails.filter((m) => toOf(m) === email);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("Repeats every week, 3 appointments:");
    expect(mails[0].html).not.toMatch(/\{\{|undefined/);
    const listed = (mails[0].text as string).split("\n").filter((l) => /^(Mon|Tues|Wednes|Thurs|Fri)day, .* at /.test(l));
    expect(listed).toHaveLength(3);
    w.assertNone();
  });

  test("a date that isn't available is marked, skipped, and explained afterwards", async ({ page }) => {
    const day = await toDetails(page, 4); // "YYYY-MM-DD"
    // block the day a week later (10:00 in Toronto is 14:00 or 15:00 UTC, inside this window)
    const next = new Date(`${day}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    const key = next.toISOString().slice(0, 10);
    await sb().from("time_off").insert({ org_id: S.orgA.id, member_id: S.orgA.members.sara, starts_at: `${key}T04:00:00Z`, ends_at: `${key}T23:00:00Z`, reason: "e2e blocked week" });

    const box = page.getByTestId("repeat-options");
    await box.getByLabel("How often").selectOption({ label: "Every week" });
    await box.getByLabel("How many appointments").selectOption({ label: "3 appointments" });
    await expect(box.getByRole("list", { name: "Dates" }).getByRole("listitem")).toHaveCount(3);
    await expect(box.getByText("Not available, so it will be skipped.")).toHaveCount(1);
    await expect(box.getByText("2 of 3 dates are available")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm 2 appointments" })).toBeVisible();

    const email = customerEmail("skip");
    await fillDetails(page, { name: "Skip Sam", email });
    await page.getByRole("button", { name: "Confirm 2 appointments" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}\?.*skipped=1/);
    await expect(page.getByTestId("series-card").getByText(/1 date wasn.t available and was skipped/)).toBeVisible();
    expect(await seriesOf(email)).toHaveLength(2);
  });

  test("the repeat options only appear for services that allow them", async ({ page }) => {
    await sb().from("services").update({ allow_series: false }).eq("id", COLOUR);
    await toDetails(page, 6);
    await expect(page.getByTestId("repeat-options")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm booking" })).toBeVisible();
  });

  test("changing the time you picked resets the repeat, so it never books a series you didn't mean", async ({ page }) => {
    await toDetails(page, 6);
    const box = page.getByTestId("repeat-options");
    await box.getByLabel("How often").selectOption({ label: "Every week" });
    await expect(box.getByRole("list", { name: "Dates" })).toBeVisible();
    await page.getByRole("button", { name: /Back/ }).click();
    await pickDay(page, 6); // Back shows the first open day again (D-032), so choose the same day as toDetails did; keeps the test independent of the time of day
    await pickTime(page, "11:00 AM");
    await expect(page.getByTestId("repeat-options").getByLabel("How often")).toHaveValue("0");
    await expect(page.getByRole("button", { name: "Confirm booking" })).toBeVisible();
  });

  test("the website pop-up version offers it too", async ({ page }) => {
    await toDetails(page, 6, `/embed/${slug}?service=colour`);
    await expect(page.getByTestId("repeat-options")).toBeVisible();
  });

  test("on a phone the repeat options fit the screen", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await toDetails(page, 6);
    const box = page.getByTestId("repeat-options");
    await box.getByLabel("How often").selectOption({ label: "Every week" });
    await box.getByLabel("How many appointments").selectOption({ label: "6 appointments" });
    await expect(box.getByRole("list", { name: "Dates" }).getByRole("listitem")).toHaveCount(6);
    const a = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [...document.querySelectorAll<HTMLElement>("[data-testid=repeat-options] select")].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length }));
    expect(a.overflow).toBeLessThanOrEqual(1);
    expect(a.small).toBe(0);
    await ctx.close();
  });
});

test.describe("the customer's manage page for a series", () => {
  async function book3(page: import("@playwright/test").Page, nth: number, name: string) {
    await toDetails(page, nth);
    const box = page.getByTestId("repeat-options");
    await box.getByLabel("How often").selectOption({ label: "Every week" });
    await box.getByLabel("How many appointments").selectOption({ label: "3 appointments" });
    await expect(box.getByRole("list", { name: "Dates" }).getByRole("listitem")).toHaveCount(3);
    const email = customerEmail("m");
    await fillDetails(page, { name, email });
    await page.getByRole("button", { name: "Confirm 3 appointments" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
    return email;
  }

  test("'cancel this and all later ones' keeps the earlier dates, and the customer and team hear about it once", async ({ page, browser }) => {
    const email = await book3(page, 7, "Cara Cancel");
    const rows = await seriesOf(email);
    await mock.clear();
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/booking/${rows[1].manage_token}`);
    await expect(p.getByTestId("series-card").getByText("2 of 3 · every week")).toBeVisible();
    await p.getByRole("button", { name: /Cancel this and all later ones \(2\)/ }).click();
    await p.getByPlaceholder(/Reason/i).fill("Away from then");
    await p.getByRole("button", { name: "Yes, cancel all" }).click();
    await expect(p.getByText("Booking cancelled").first()).toBeVisible();
    const after = await seriesOf(email);
    expect(after.map((r) => r.status)).toEqual(["confirmed", "cancelled", "cancelled"]);
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await p.waitForTimeout(1500);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === email)).toHaveLength(1);
    // the first date's page shows the others as cancelled
    const first = await ctx.newPage();
    await first.goto(`/booking/${rows[0].manage_token}`);
    await expect(first.getByTestId("series-card").getByText("Cancelled")).toHaveCount(2);
    await ctx.close();
  });

  test("a single date can still be cancelled alone", async ({ page, browser }) => {
    const email = await book3(page, 10, "Sid Single");
    const rows = await seriesOf(email);
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/booking/${rows[1].manage_token}`);
    await p.getByRole("button", { name: "Cancel booking" }).click();
    await p.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(p.getByText("Booking cancelled").first()).toBeVisible();
    expect((await seriesOf(email)).map((r) => r.status)).toEqual(["confirmed", "cancelled", "confirmed"]);
    await ctx.close();
  });
});

test.describe("the team", () => {
  const futureDay = (n: number) => {
    const d = new Date(Date.now() + n * 86_400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  async function addSeries(page: import("@playwright/test").Page, day: string, name: string, email: string, weeks: string, count: string) {
    await page.goto(`${base}/calendar`);
    await page.getByRole("button", { name: /^New/ }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /^Colour/ }).click();
    await sheet.getByLabel("Date").fill(day);
    await sheet.getByLabel("Time").selectOption({ label: "10:00 AM" });
    await sheet.getByRole("button", { name: /Sara Stylist/ }).click();
    const newTab = sheet.getByRole("tab", { name: "New", exact: true });
    if (await newTab.count()) await newTab.click();
    await sheet.getByPlaceholder("Full name").fill(name);
    await sheet.getByPlaceholder("Email").fill(email);
    await sheet.getByLabel("How often").selectOption({ label: weeks });
    if (!weeks.startsWith("Doesn")) await sheet.getByLabel("How many appointments").selectOption({ label: count });
    return sheet;
  }

  test("adding a repeating booking books each date, shows the result, sends one confirmation, and the sheet shows the series", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const email = customerEmail("team");
    const sheet = await addSeries(page, futureDay(100), "Tara Team", email, "Every 2 weeks", "3 appointments");
    await sheet.getByRole("button", { name: "Add booking" }).click();
    const out = page.getByTestId("series-outcome");
    await expect(out.getByText("3 appointments were added to the calendar.")).toBeVisible();
    await expect(out.getByText(/were skipped/)).toHaveCount(0);
    await out.getByRole("button", { name: "Done" }).click();

    const rows = await seriesOf(email);
    expect(rows).toHaveLength(3);
    const gaps = rows.slice(1).map((r, i) => Math.round((new Date(r.starts_at).getTime() - new Date(rows[i].starts_at).getTime()) / 86_400_000));
    expect(gaps).toEqual([14, 14]);
    const { data: ser } = await sb().from("booking_series").select("source, interval_weeks, count_requested").eq("id", rows[0].series_id!).single();
    expect(ser).toEqual({ source: "manual", interval_weeks: 2, count_requested: 3 });
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const mails = (await mock.sent()).emails.filter((m) => toOf(m) === email);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("Repeats every 2 weeks, 3 appointments:");

    // the team's booking list marks them; the booking sheet shows where it sits and offers to cancel the rest
    await page.goto(`${base}/bookings`);
    const row = page.getByRole("button", { name: /Tara Team/ }).first();
    await expect(row.getByLabel("Part of a repeating series")).toBeVisible();
    await row.click();
    const sheet2 = page.getByRole("dialog");
    await expect(sheet2.getByText("Repeating appointment")).toBeVisible();
    await expect(sheet2.getByText("1 of 3 · every 2 weeks")).toBeVisible();
    await mock.clear();
    await sheet2.getByRole("button", { name: /Cancel this and later ones \(3\)/ }).click();
    await sheet2.getByRole("button", { name: /Tap to confirm: cancel 3 appointments/ }).click();
    await expect(page.getByText("3 appointments cancelled")).toBeVisible();
    expect((await seriesOf(email)).map((r) => r.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === email)).toHaveLength(1);
    w.assertNone();
  });

  test("dates that don't fit are skipped and listed with the reason; the first date has to work", async ({ pageAs }) => {
    const day = futureDay(60);
    const page = await pageAs("ownerA");
    // someone already has Sara a week later, same time: that date can't be booked
    const nextWeek = new Date(`${day}T12:00:00Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const blocker = await addSeries(page, nextWeek.toISOString().slice(0, 10), "Block Bea", customerEmail("tblock"), "Doesn't repeat", "2 appointments");
    await blocker.getByRole("button", { name: "Add booking" }).click();
    await expect(page.getByText("Booking added")).toBeVisible();
    const email = customerEmail("tskip");
    const sheet = await addSeries(page, day, "Skip Tess", email, "Every week", "3 appointments");
    await sheet.getByRole("button", { name: "Add booking" }).click();
    const out = page.getByTestId("series-outcome");
    await expect(out.getByText("2 appointments were added to the calendar.")).toBeVisible();
    await expect(out.getByText("1 date was skipped")).toBeVisible();
    await expect(out.getByText(/time off|can.t|outside|not scheduled|overlap|available/i).first()).toBeVisible();
    await out.getByRole("button", { name: "Done" }).click();
    expect(await seriesOf(email)).toHaveLength(2);

    // a first date that can't be booked: refused, nothing created
    const bad = customerEmail("tbad");
    const sheet2 = await addSeries(page, day, "Bad Bo", bad, "Every week", "3 appointments"); // the first date is now taken by the booking above
    await sheet2.getByRole("button", { name: "Add booking" }).click();
    await expect(sheet2.locator("text=/overlap|already|not scheduled|taken/i").first()).toBeVisible();
    const { data: custs } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", bad);
    if (custs?.length) expect(await seriesOf(bad)).toHaveLength(0);
  });
});
