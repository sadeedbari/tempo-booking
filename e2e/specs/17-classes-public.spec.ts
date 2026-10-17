import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, mock, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let svcId = "";

/** An instant `days` ahead at 19:00 UTC (mid-afternoon in Toronto), plus `hours`. */
const inDays = (days: number, hours = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(19 + hours, 0, 0, 0);
  return d.toISOString();
};
async function session(o: { days: number; capacity?: number; member?: string; location?: string | null; notes?: string }) {
  const start = inDays(o.days);
  const end = inDays(o.days, 1);
  const { data, error } = await sb()
    .from("class_sessions")
    .insert({ org_id: S.orgA.id, service_id: svcId, member_id: o.member ?? S.orgA.members.sara, location_id: o.location === undefined ? S.orgA.locations.qw : o.location, starts_at: start, ends_at: end, blocked_until: end, capacity: o.capacity ?? 3, notes: o.notes ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
async function fill(sessionId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const { error } = await sb().rpc("create_public_session_booking", { p_org: S.orgA.id, p_session: sessionId, p_name: `Filler ${i}`, p_email: customerEmail("fill"), p_phone: "", p_notes: "" });
    if (error) throw new Error(error.message);
  }
}

test.beforeEach(async () => {
  await mock.clear();
  const c = sb();
  if (!svcId) {
    const found = await c.from("services").select("id").eq("org_id", S.orgA.id).eq("slug", "spec-class").maybeSingle();
    if (found.data) svcId = found.data.id;
    else {
      const { data, error } = await c.from("services").insert({ org_id: S.orgA.id, name: "Spec Class", slug: "spec-class", description: "A relaxed flow session", duration_minutes: 60, price_cents: 2500, is_class: true, class_capacity: 3, position: 96 }).select("id").single();
      if (error) throw new Error(error.message);
      svcId = data!.id;
    }
  }
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
});
test.afterAll(async () => {
  const c = sb();
  if (svcId) {
    await c.from("bookings").delete().eq("service_id", svcId);
    await c.from("class_sessions").delete().eq("service_id", svcId);
    await c.from("services").delete().eq("id", svcId);
  }
});

async function toSessions(page: import("@playwright/test").Page, url = `/${slug}`) {
  await page.goto(url);
  await page.getByRole("button", { name: /Queen West/ }).click();
  if (!url.includes("service=")) await page.getByRole("button", { name: /^Spec Class/ }).click();
  await expect(page.getByRole("heading", { name: "Choose a session" })).toBeVisible();
}

test.describe("booking a spot in a class", () => {
  test("a class is marked as one, shows its sessions with spots left, and a booking takes a spot", async ({ page, browser }) => {
    const w = watchErrors(page);
    const open = await session({ days: 3, capacity: 3, notes: "Bring a mat" });
    const fullOne = await session({ days: 4, capacity: 1 });
    await fill(fullOne, 1);

    await page.goto(`/${slug}`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    await expect(page.getByRole("button", { name: /^Spec Class/ }).getByText("Group class")).toBeVisible();
    await page.getByRole("button", { name: /^Spec Class/ }).click();
    await expect(page.getByRole("heading", { name: "Choose a session" })).toBeVisible();
    // no "who would you like" step: the session decides who leads it
    await expect(page.getByRole("heading", { name: "Who would you like?" })).toHaveCount(0);
    const list = page.getByTestId("session-list");
    await expect(list.getByRole("button")).toHaveCount(2);
    await expect(list.getByText("Bring a mat")).toBeVisible();
    await expect(list.getByRole("button", { name: /3 spots left/ })).toBeVisible();
    const full = list.getByRole("button", { name: /full/ });
    await expect(full).toBeDisabled();
    await expect(full.getByText("Full")).toBeVisible();

    await list.getByRole("button", { name: /3 spots left/ }).click();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    // none of the appointment-only extras
    await expect(page.getByTestId("repeat-options")).toHaveCount(0);
    await expect(page.getByLabel(/^Address/)).toHaveCount(0);
    const email = customerEmail("class");
    await fillDetails(page, { name: "Clara Class", email });
    await page.getByRole("button", { name: "Reserve my spot" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
    await expect(page.getByText("Spec Class").first()).toBeVisible();
    await expect(page.getByText(/Sara Stylist/).first()).toBeVisible();

    // a class spot can be cancelled but not rescheduled
    await expect(page.getByRole("link", { name: /Reschedule/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Cancel booking/ })).toBeVisible();

    // the booking and the email
    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: rows } = await sb().from("bookings").select("session_id, status, member_id").eq("customer_id", cust!.id);
    expect(rows).toEqual([{ session_id: open, status: "confirmed", member_id: S.orgA.members.sara }]);
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => (Array.isArray(m.to) ? m.to[0] : m.to) === email).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const mail = (await mock.sent()).emails.find((m) => (Array.isArray(m.to) ? m.to[0] : m.to) === email);
    expect(mail.subject).toBe("Confirmed: Spec Class with E2E Salon");

    // the list now shows one fewer spot
    const p2 = await (await browser.newContext()).newPage();
    await toSessions(p2, `/${slug}?service=spec-class`);
    await expect(p2.getByTestId("session-list").getByRole("button", { name: /2 spots left/ })).toBeVisible();
    // cancelling brings it back
    await page.getByRole("button", { name: /Cancel booking/ }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Booking cancelled").first()).toBeVisible();
    await p2.reload();
    await p2.getByRole("button", { name: /Queen West/ }).click();
    await expect(p2.getByTestId("session-list").getByRole("button", { name: /3 spots left/ })).toBeVisible();
    w.assertNone();
  });

  test("a class link skips the service list, and a session at another location isn't offered", async ({ page }) => {
    await session({ days: 3, location: S.orgA.locations.qw });
    await session({ days: 4, location: S.orgA.locations.le });
    await toSessions(page, `/${slug}?service=spec-class`);
    await expect(page.getByTestId("session-list").getByRole("button")).toHaveCount(1);
  });

  test("the last spot taken while someone fills in their details gives a friendly message and the list", async ({ page }) => {
    const id = await session({ days: 3, capacity: 1 });
    await session({ days: 5, capacity: 4 });
    await toSessions(page);
    await page.getByTestId("session-list").getByRole("button", { name: /1 spot left/ }).click();
    await fillDetails(page, { name: "Late Lena", email: customerEmail("late") });
    await fill(id, 1); // someone else gets there first
    await page.getByRole("button", { name: "Reserve my spot" }).click();
    await expect(page.getByText(/full/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a session" })).toBeVisible();
    await expect(page.getByTestId("session-list").getByRole("button", { name: /full/ })).toBeDisabled();
    await expect(page.getByTestId("session-list").getByRole("button", { name: /4 spots left/ })).toBeVisible();
  });

  test("a class with no sessions says so", async ({ page }) => {
    await toSessions(page);
    await expect(page.getByTestId("no-sessions")).toBeVisible();
  });

  test("the website pop-up version lists sessions too, and a phone fits them on screen", async ({ page, browser }) => {
    await session({ days: 3 });
    await page.goto(`/embed/${slug}`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    await page.getByRole("button", { name: /^Spec Class/ }).click();
    await expect(page.getByTestId("session-list").getByRole("button", { name: /3 spots left/ })).toBeVisible();

    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
    const m = await ctx.newPage();
    await toSessions(m);
    const small = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(small).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  test("the back button returns from the details to the sessions", async ({ page }) => {
    await session({ days: 3 });
    await toSessions(page);
    await page.getByTestId("session-list").getByRole("button", { name: /3 spots left/ }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Choose a session" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  });
});
