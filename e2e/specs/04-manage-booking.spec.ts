import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerEmail, dayAhead, mock, pickDay, pickTime, rpcBook, S, watchErrors } from "./helpers";

test.beforeEach(async () => { await mock.clear(); });
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const mails = async (to: string) => (await mock.sent()).emails.filter((e) => ([] as string[]).concat(e.to).includes(to));

test.describe("the customer's booking page", () => {
  test("shows the details and offers a calendar file", async ({ page, request }) => {
    const email = customerEmail("manage");
    const b = await rpcBook({ day: dayAhead(12), time: "10:00", email, name: "Manage Me" });
    const w = watchErrors(page);
    await page.goto(`/booking/${b.manage_token}`);
    await expect(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
    await expect(page.getByText("Haircut").first()).toBeVisible();
    await expect(page.getByText("Sara Stylist")).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Add to Calendar/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reschedule/ })).toBeVisible();
    const ics = await request.get(`/booking/${b.manage_token}/ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const body = await ics.text();
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:Haircut");
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    w.assertNone();
  });

  test("cancelling: asks first, cancels, tells the customer, frees the time, and can't be repeated", async ({ page }) => {
    const email = customerEmail("cancel");
    const day = dayAhead(13);
    const b = await rpcBook({ day, time: "11:00", email });
    await page.goto(`/booking/${b.manage_token}`);
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByPlaceholder("Reason (optional)").fill("Plans changed");
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Book a new time" })).toBeVisible();
    await expect.poll(async () => (await mails(email)).length, { timeout: 15_000 }).toBe(1);
    expect((await mails(email))[0].subject).toBe("Cancelled: Haircut with E2E Salon");
    const { data } = await admin().from("bookings").select("status, cancel_reason").eq("id", b.id).single();
    expect(data).toEqual({ status: "cancelled", cancel_reason: "Plans changed" });
    // the time can be booked again by someone else
    await rpcBook({ day, time: "11:00" });
    // reloading shows the cancelled state, not an error
    await page.reload();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
  });

  test("rescheduling: pick a new time, see the confirmation, and the customer is emailed", async ({ page }) => {
    const email = customerEmail("resched");
    const b = await rpcBook({ day: dayAhead(14), time: "10:00", email });
    await page.goto(`/booking/${b.manage_token}/reschedule`);
    await expect(page.getByRole("heading", { name: "Pick a new time" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose a time" })).toBeDisabled();
    await pickDay(page, 8);
    await pickTime(page, "3:00 PM");
    await page.getByRole("button", { name: /^Move to/ }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}\?moved=1/);
    await expect(page.getByText("Your booking has been moved.")).toBeVisible();
    await expect(page.getByText(/3:00 PM/).first()).toBeVisible();
    await expect.poll(async () => (await mails(email)).length, { timeout: 15_000 }).toBe(1);
    expect((await mails(email))[0].subject).toBe("Updated: Haircut with E2E Salon");
  });

  test("inside the cancellation window the customer is told to contact the business instead", async ({ page }) => {
    const sb = admin();
    const soon = new Date(Date.now() + 5 * 3600_000);
    const { data: c } = await sb.from("customers").insert({ org_id: S.orgA.id, name: "Late", email: customerEmail("late") }).select("id").single();
    const { data: b } = await sb.from("bookings").insert({
      org_id: S.orgA.id, member_id: S.orgA.members.olivia, service_id: S.orgA.services.haircut, service_name: "Haircut", customer_id: c!.id,
      starts_at: soon.toISOString(), ends_at: new Date(soon.getTime() + 3600_000).toISOString(), blocked_until: new Date(soon.getTime() + 3600_000).toISOString(),
      status: "confirmed", price_cents: 8500, currency: "CAD", source: "manual", location_id: S.orgA.locations.qw,
    }).select("manage_token").single();
    await page.goto(`/booking/${b!.manage_token}`);
    await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Reschedule/ })).toHaveCount(0);
    await expect(page.getByText(/Need to change something/)).toBeVisible();
    // going straight to the reschedule page doesn't offer a way around the rule
    await page.goto(`/booking/${b!.manage_token}/reschedule`);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
    const picker = page.getByRole("button", { name: "Choose a time" });
    if (await picker.count()) {
      await pickDay(page, 3);
      await pickTime(page, "10:00 AM");
      await page.getByRole("button", { name: /^Move to/ }).click();
      await expect(page.getByText(/closed|contact/i)).toBeVisible();
    }
  });

  test("a request waiting for approval can be withdrawn", async ({ page }) => {
    const b = await rpcBook({ day: dayAhead(15), time: "09:00", service: S.orgA.services.homevisit, member: S.orgA.members.sam, location: S.orgA.locations.le, address: "5 Test Rd, Toronto" });
    await page.goto(`/booking/${b.manage_token}`);
    await expect(page.getByRole("heading", { name: "Awaiting confirmation" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Reschedule/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
  });

  test("bad or cancelled links fail gracefully", async ({ page, request }) => {
    for (const path of ["/booking/zzz", `/booking/${"0".repeat(48)}`, `/booking/${"0".repeat(48)}/reschedule`, `/booking/${"0".repeat(48)}/ics`, "/booking/%27%3B%20drop%20table", "/booking/" + "a".repeat(3000)]) {
      const res = await request.get(path);
      expect([404, 400, 414], path.slice(0, 40)).toContain(res.status());
    }
    const b = await rpcBook({ day: dayAhead(16), time: "09:00" });
    await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!).from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    await page.goto(`/booking/${b.manage_token}/reschedule`);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
  });
});
