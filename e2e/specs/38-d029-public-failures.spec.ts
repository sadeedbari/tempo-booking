// D-029 end to end: every customer-facing flow (public page and embed) with the connection lost and with HTTP 500.
// The customer stays on the page, sees an inline message in a live region, keeps what they typed, the button works
// again, a retry succeeds, and NOTHING goes to /login. Also: a signed-in staff member using a PUBLIC page is a customer
// there, and a signed-in dashboard button with an ended session still goes to /login?error=session.
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { customerEmail, dayAhead, fillDetails, mock, pickDay, pickTime, rpcBook, S } from "./helpers";

const slug = S.orgA.slug;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MSG = /Something went wrong\. Please check your connection and try again\./;
type Mode = "offline" | "http500";
const MODES: Mode[] = ["offline", "http500"];

async function fail(page: Page, mode: Mode) {
  await page.route("**/*", (route) => {
    const r = route.request();
    if (r.method() === "POST" && r.headers()["next-action"]) {
      return mode === "offline" ? route.abort("internetdisconnected") : route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
    }
    return route.continue();
  });
}
const unfail = (page: Page) => page.unroute("**/*");
const notLogin = (page: Page) => expect(page.url(), "must not be sent to the sign-in page").not.toMatch(/\/login/);
/** The message must be inside a live region (role=alert or role=status), exactly once. */
async function announced(page: Page) {
  const live = page.locator('[role="alert"], [role="status"]').filter({ hasText: MSG });
  await expect(live.first()).toBeVisible();
  await page.waitForTimeout(600);
  notLogin(page);
  expect(await live.count(), "announced once, not twice").toBe(1);
}

test.beforeEach(async () => { await mock.clear(); });

for (const mode of MODES) {
  const K = mode === "offline" ? 0 : 3;
  const T = mode === "offline" ? "10:00 AM" : "11:00 AM"; // different time per mode so the two runs never collide on the same slot
  test.describe(`customer flows, request fails (${mode})`, () => {
    test(`embed booking flow: Confirm booking`, async ({ page }) => {
      await page.goto(`/embed/${slug}`);
      await page.getByRole("button", { name: /Queen West/ }).click();
      await page.getByRole("button", { name: /^Haircut/ }).click();
      await page.getByRole("button", { name: /Sara Stylist/ }).click();
      await pickDay(page, 5 + K);
      await pickTime(page, T);
      const email = customerEmail("em");
      await fillDetails(page, { name: "Embed Fail", email, notes: "embed notes" });
      await fail(page, mode);
      const btn = page.getByRole("button", { name: "Confirm booking" });
      await btn.click();
      await announced(page);
      await expect(page.getByLabel("Full name")).toHaveValue("Embed Fail");
      await expect(page.getByLabel("Anything we should know?")).toHaveValue("embed notes");
      await expect(btn).toBeEnabled();
      await unfail(page);
      await btn.click();
      await expect(page.getByText(/You.re booked|Booking confirmed|confirmed/i).first()).toBeVisible({ timeout: 20_000 });
      notLogin(page);
      expect((await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email)).data).toHaveLength(1);
    });

    test(`embed contact form`, async ({ page }) => {
      await sb().from("organizations").update({ inquiries_enabled: true }).eq("id", S.orgA.id);
      await sb().from("services").update({ contact_form: true }).eq("org_id", S.orgA.id);
      await page.goto(`/embed/${slug}/contact`);
      await page.getByLabel("Full name").fill("Embed Contact");
      await page.getByLabel("Email").fill(customerEmail("ec"));
      await page.getByLabel("Your message").fill("Embedded message to keep");
      await page.waitForTimeout(2400);
      await fail(page, mode);
      const send = page.getByRole("button", { name: "Send message" });
      await send.click();
      await announced(page);
      await expect(page.getByLabel("Your message")).toHaveValue("Embedded message to keep");
      await expect(send).toBeEnabled();
      await unfail(page);
      await send.click();
      await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
    });

    test(`cancel: the typed Reason is kept, one announced message`, async ({ page }) => {
      const b = await rpcBook({ day: dayAhead(30 + K), time: "11:00", email: customerEmail("kc") });
      await page.goto(`/booking/${b.manage_token}`);
      await page.getByRole("button", { name: "Cancel booking" }).click();
      await page.getByPlaceholder("Reason (optional)").fill("Plans changed é ü 日本");
      await fail(page, mode);
      await page.getByRole("button", { name: "Yes, cancel" }).click();
      await announced(page);
      await expect(page.getByPlaceholder("Reason (optional)")).toHaveValue("Plans changed é ü 日本");
      await expect(page.getByRole("button", { name: "Yes, cancel" })).toBeEnabled();
      await unfail(page);
      await page.getByRole("button", { name: "Yes, cancel" }).click();
      await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
      const row = (await sb().from("bookings").select("status, cancel_reason").eq("id", b.id).single()).data as { status: string; cancel_reason?: string } | null;
      expect(row!.status).toBe("cancelled");
    });

    test(`cancel a series: the typed Reason is kept`, async ({ page }) => {
      const COLOUR = S.orgA.services.colour;
      await sb().from("services").update({ allow_series: true, auto_approve: true }).eq("id", COLOUR);
      try {
        await page.goto(`/${slug}?service=colour`);
        await page.getByRole("button", { name: /Queen West/ }).click();
        await pickDay(page, 9 + K);
        await pickTime(page, T);
        const box = page.getByTestId("repeat-options");
        await box.getByLabel("How often").selectOption({ label: "Every week" });
        await box.getByLabel("How many appointments").selectOption({ label: "3 appointments" });
        await expect(box.getByRole("list", { name: "Dates" }).getByRole("listitem")).toHaveCount(3);
        await fillDetails(page, { name: "Series Fail", email: customerEmail("sf") });
        await page.getByRole("button", { name: "Confirm 3 appointments" }).click();
        await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
        await page.getByRole("button", { name: /Cancel this and all later ones/ }).click();
        await page.getByPlaceholder(/Reason/i).fill("Away from then");
        await fail(page, mode);
        await page.getByRole("button", { name: "Yes, cancel all" }).click();
        await announced(page);
        await expect(page.getByPlaceholder(/Reason/i)).toHaveValue("Away from then");
        await expect(page.getByRole("button", { name: "Yes, cancel all" })).toBeEnabled();
        await unfail(page);
        await page.getByRole("button", { name: "Yes, cancel all" }).click();
        await expect(page.getByText("Booking cancelled").first()).toBeVisible();
      } finally {
        await sb().from("services").update({ allow_series: false }).eq("id", COLOUR);
      }
    });

    test(`booking with intake questions: answers kept`, async ({ page }) => {
      const HAIRCUT = S.orgA.services.haircut;
      await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
      await sb().from("service_questions").insert({ org_id: S.orgA.id, service_id: HAIRCUT, label: "Any allergies?", type: "text", options: [], required: true, position: 0 });
      try {
        await page.goto(`/${slug}`);
        await page.getByRole("button", { name: /Queen West/ }).click();
        await page.getByRole("button", { name: /^Haircut/ }).click();
        await page.getByRole("button", { name: /Sara Stylist/ }).click();
        await pickDay(page, 12 + K);
        await pickTime(page, T);
        const email = customerEmail("iq");
        await fillDetails(page, { name: "Intake Fail", email });
        const box = page.getByTestId("intake-questions");
        await box.getByLabel(/Any allergies/).fill("Latex");
        await fail(page, mode);
        const btn = page.getByRole("button", { name: "Confirm booking" });
        await btn.click();
        await announced(page);
        await expect(box.getByLabel(/Any allergies/)).toHaveValue("Latex");
        await expect(btn).toBeEnabled();
        await unfail(page);
        await btn.click();
        await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
        const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
        const { data: b } = await sb().from("bookings").select("answers").eq("customer_id", cust!.id).single();
        expect(JSON.stringify(b!.answers)).toContain("Latex");
      } finally {
        await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
      }
    });

    test(`group class: reserve a spot and join the waitlist`, async ({ page }) => {
      const c = sb();
      const { data: svc } = await c.from("services").insert({ org_id: S.orgA.id, name: "Group D29", slug: "group-d29", duration_minutes: 60, price_cents: 2000, is_class: true, class_capacity: 2, position: 85 }).select("id").single();
      try {
        const inDays = (days: number, hours = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(19 + hours, 0, 0, 0); return d.toISOString(); };
        const mk = async (days: number) => (await c.from("class_sessions").insert({ org_id: S.orgA.id, service_id: svc!.id, member_id: S.orgA.members.sara, location_id: S.orgA.locations.qw, starts_at: inDays(days), ends_at: inDays(days, 1), blocked_until: inDays(days, 1), capacity: 2 }).select("id").single()).data!.id as string;
        const open = await mk(5 + K);
        const full = await mk(6 + K);
        const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
        for (let i = 0; i < 2; i++) await pub.rpc("create_public_session_booking", { p_org: S.orgA.id, p_session: full, p_name: `Filler ${i}`, p_email: customerEmail("gf"), p_phone: "", p_notes: "", p_spots: 1 });
        void open;
        // reserve
        await page.goto(`/${slug}?service=group-d29`);
        await page.getByRole("button", { name: /Queen West/ }).click();
        await page.getByTestId("session-list").getByRole("button", { name: /2 spots left/ }).click();
        const email = customerEmail("gr");
        await fillDetails(page, { name: "Spot Fail", email, notes: "my spot notes" });
        await fail(page, mode);
        const reserve = page.getByRole("button", { name: /^Reserve/ });
        await reserve.click();
        await announced(page);
        await expect(page.getByLabel("Full name")).toHaveValue("Spot Fail");
        await expect(page.getByLabel("Anything we should know?")).toHaveValue("my spot notes");
        await expect(reserve).toBeEnabled();
        await unfail(page);
        await reserve.click();
        await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
        // waitlist
        await page.goto(`/${slug}?service=group-d29`);
        await page.getByRole("button", { name: /Queen West/ }).click();
        await page.getByTestId("session-list").getByRole("button", { name: /full/ }).click();
        await fillDetails(page, { name: "Wait Fail", email: customerEmail("gw"), notes: "wait notes" });
        await fail(page, mode);
        const join = page.getByRole("button", { name: "Join the waitlist" });
        await join.click();
        await announced(page);
        await expect(page.getByLabel("Full name")).toHaveValue("Wait Fail");
        await expect(page.getByLabel("Anything we should know?")).toHaveValue("wait notes");
        await expect(join).toBeEnabled();
        await unfail(page);
        await join.click();
        await page.waitForURL(/\/waitlist\/[a-f0-9]{48}/);
      } finally {
        await c.from("class_waitlist").delete().eq("org_id", S.orgA.id);
        await c.from("bookings").delete().eq("service_id", svc!.id);
        await c.from("class_sessions").delete().eq("service_id", svc!.id);
        await c.from("services").delete().eq("id", svc!.id);
      }
    });

    test(`reschedule and waitlist leave: one announced message`, async ({ page }) => {
      const b = await rpcBook({ day: dayAhead(33 + K), time: "10:00", email: customerEmail("rr") });
      await page.goto(`/booking/${b.manage_token}/reschedule`);
      await pickDay(page, 8 + K);
      await pickTime(page, "3:00 PM");
      await fail(page, mode);
      const move = page.getByRole("button", { name: /^Move to/ });
      await move.click();
      await announced(page);
      await expect(move).toBeEnabled();
      await unfail(page);
      await move.click();
      await page.waitForURL(/\?moved=1/);
    });
  });
}

// ---------- a signed-in staff member on a PUBLIC page is a customer there ----------
for (const mode of MODES) {
  test(`signed-in owner using the public booking page and a customer link (${mode}): not treated as a session-ended user`, async ({ pageAs }) => {
    const K = mode === "offline" ? 0 : 3;
    const T = "9:00 AM"; // a time no other test in this file books
    const page = await pageAs("ownerA");
    await page.goto(`/${slug}`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    await page.getByRole("button", { name: /^Haircut/ }).click();
    await page.getByRole("button", { name: /Sara Stylist/ }).click();
    await pickDay(page, 14 + K);
    await pickTime(page, T);
    await fillDetails(page, { name: "Owner As Customer", email: customerEmail("so") });
    await fail(page, mode);
    const btn = page.getByRole("button", { name: "Confirm booking" });
    await btn.click();
    await announced(page);
    await expect(btn).toBeEnabled();
    await unfail(page);
    // and now with the session really gone, a customer page failure must still not go to /login
    await page.context().clearCookies();
    await fail(page, mode);
    await btn.click();
    await announced(page);
    await expect(page.getByLabel("Full name")).toHaveValue("Owner As Customer");
    await unfail(page);
  });
}

// ---------- a dashboard button with an ended session still goes to the sign-in page ----------
for (const mode of MODES) {
  test(`dashboard button, session ended, request fails (${mode}): /login?error=session with the message`, async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const { login } = await import("./helpers");
    await login(page, "ownerA");
    await page.goto(`/o/${slug}/workflows`);
    const sw = page.getByRole("switch").first();
    await expect(sw).toBeVisible();
    await ctx.clearCookies();
    await page.route("**/*", (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) {
        return mode === "offline" ? route.abort("internetdisconnected") : route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
      }
      return route.continue();
    });
    await sw.click();
    await page.waitForURL(/\/login\?error=session/, { timeout: 20_000 });
    await expect(page.getByText(/session (has )?ended|signed out|sign in again/i).first()).toBeVisible();
    await ctx.close();
  });
}
