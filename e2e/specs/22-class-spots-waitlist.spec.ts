import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, mock, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
const base = `/o/${slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;
let svcId = "";

const dayKeyAhead = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const inDays = (days: number, hours = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(19 + hours, 0, 0, 0); return d.toISOString(); };

async function session(o: { days: number; capacity?: number }) {
  const { data, error } = await sb()
    .from("class_sessions")
    .insert({ org_id: S.orgA.id, service_id: svcId, member_id: S.orgA.members.sara, location_id: S.orgA.locations.qw, starts_at: inDays(o.days), ends_at: inDays(o.days, 1), blocked_until: inDays(o.days, 1), capacity: o.capacity ?? 4 })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
async function join(sessionId: string, name: string, spots = 1) {
  const email = customerEmail("sw");
  const { data, error } = await sb().rpc("create_public_session_booking", { p_org: S.orgA.id, p_session: sessionId, p_name: name, p_email: email, p_phone: "", p_notes: "", p_spots: spots });
  if (error) throw new Error(error.message);
  return { email, id: (data as { id: string }).id, token: (data as { manage_token: string }).manage_token };
}
async function wait(sessionId: string, name: string, spots = 1) {
  const email = customerEmail("ww");
  const { data, error } = await sb().rpc("join_class_waitlist", { p_org: S.orgA.id, p_session: sessionId, p_name: name, p_email: email, p_phone: "", p_notes: "", p_spots: spots });
  if (error) throw new Error(error.message);
  return { email, token: (data as { token: string }).token };
}
const entry = async (token: string) => (await sb().from("class_waitlist").select("status, booking_id, notified_at").eq("token", token).single()).data!;
const taken = async (id: string) => (await sb().from("bookings").select("spots").eq("session_id", id).in("status", ["confirmed", "pending_approval"])).data!.reduce((n, b) => n + b.spots, 0);

test.beforeAll(async () => {
  const { data, error } = await sb().from("services").insert({ org_id: S.orgA.id, name: "Group Flow", slug: "group-flow", duration_minutes: 60, price_cents: 2000, is_class: true, class_capacity: 4, position: 86 }).select("id").single();
  if (error) throw new Error(error.message);
  svcId = data!.id;
});
test.beforeEach(async () => {
  await mock.clear();
  const c = sb();
  await c.from("class_waitlist").delete().eq("org_id", S.orgA.id);
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
});
test.afterAll(async () => {
  const c = sb();
  await c.from("class_waitlist").delete().eq("org_id", S.orgA.id);
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
  await c.from("services").delete().eq("id", svcId);
});

async function toSessions(page: import("@playwright/test").Page) {
  await page.goto(`/${slug}?service=group-flow`);
  await page.getByRole("button", { name: /Queen West/ }).click();
  await expect(page.getByRole("heading", { name: "Choose a session" })).toBeVisible();
}

test.describe("several spots in one booking", () => {
  test("a customer books two spots for a friend: total price, guest name, email, and the spots taken", async ({ page }) => {
    const w = watchErrors(page);
    const id = await session({ days: 6, capacity: 5 });
    await join(id, "Already Booked");
    await toSessions(page);
    await page.getByTestId("session-list").getByRole("button", { name: /4 spots left/ }).click();
    const picker = page.getByTestId("spots-options");
    await expect(picker.getByLabel("How many spots")).toBeVisible();
    // up to the spots left (four), never more than six
    await expect(picker.getByLabel("How many spots").locator("option")).toHaveCount(4);
    await picker.getByLabel("How many spots").selectOption({ label: "3 spots" });
    await expect(page.getByText(/\$60.*for 3 spots/)).toBeVisible();
    await picker.getByPlaceholder(/Sam and Alex/).fill("Sam and Alex");
    await expect(page.getByRole("button", { name: "Reserve 3 spots" })).toBeVisible();
    const email = customerEmail("three");
    await fillDetails(page, { name: "Trio Booker", email });
    await page.getByRole("button", { name: "Reserve 3 spots" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
    await expect(page.getByText(/3 spots · Sam and Alex/)).toBeVisible();
    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: row } = await sb().from("bookings").select("spots, price_cents, guest_names").eq("customer_id", cust!.id).single();
    expect(row).toEqual({ spots: 3, price_cents: 6000, guest_names: "Sam and Alex" });
    expect(await taken(id)).toBe(4);
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBe(1);
    const mail = (await mock.sent()).emails.find((m) => toOf(m) === email);
    expect(mail.text).toContain("Spots: 3 spots");
    expect(mail.html).not.toMatch(/\{\{/);
    // the list now shows one spot left, and with one left there is no spot picker
    await toSessions(page);
    const left = page.getByTestId("session-list").getByRole("button", { name: /1 spot left/ });
    await expect(left).toBeVisible();
    await left.click();
    await expect(page.getByTestId("spots-options")).toHaveCount(0);
    w.assertNone();
  });

  test("the team adds a walk-in with two spots; the roster and the count follow, and too many are refused", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6, capacity: 3 });
    await join(id, "Ann Attendee");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await expect(page.getByTestId("session-block").getByText("1/3")).toBeVisible();
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");
    await sheet.getByRole("button", { name: "Add someone" }).click();
    const add = sheet.getByTestId("add-person");
    const newTab = add.getByRole("tab", { name: "New", exact: true });
    if (await newTab.count()) await newTab.click();
    await add.getByPlaceholder("Full name").fill("Wes Walkin");
    await add.getByPlaceholder("Email").fill(customerEmail("walk"));
    await add.getByLabel("How many spots").selectOption({ label: "2 spots" });
    await add.getByPlaceholder(/Who's coming with them/).fill("His sister");
    await add.getByRole("button", { name: "Add to session" }).click();
    await expect(page.getByText("Added to the session")).toBeVisible();
    await expect(page.getByTestId("session-count")).toHaveText("3 of 3 booked");
    const person = sheet.getByTestId("attendee").filter({ hasText: "Wes Walkin" });
    await expect(person.getByText("2 spots")).toBeVisible();
    await expect(person.getByText("With: His sister")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Add someone (full)" })).toBeVisible();
    // removing the group frees both spots
    await person.getByRole("button", { name: "Remove" }).click();
    await person.getByRole("button", { name: "Tap to confirm" }).click();
    await expect(page.getByText("Wes Walkin removed")).toBeVisible();
    await expect(page.getByTestId("session-count")).toHaveText("1 of 3 booked");
  });
});

test.describe("the waitlist", () => {
  test("a full session can be waited for: joining, the place in line, the email, and leaving", async ({ page }) => {
    const w = watchErrors(page);
    const id = await session({ days: 6, capacity: 2 });
    await join(id, "First");
    await join(id, "Second");
    await toSessions(page);
    const full = page.getByTestId("session-list").getByRole("button", { name: /full/ });
    await expect(full.getByText("Full · join waitlist")).toBeVisible();
    await full.click();
    await expect(page.getByTestId("waitlist-note")).toBeVisible();
    await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeVisible();
    const email = customerEmail("wait");
    await fillDetails(page, { name: "Wendy Waiter", email });
    await mock.clear();
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await page.waitForURL(/\/waitlist\/[a-f0-9]{48}/);
    await expect(page.getByTestId("waitlist-title")).toHaveText("You're on the waitlist");
    await expect(page.getByTestId("waitlist-position")).toContainText("Place in line: 1");
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBe(1);
    const mail = (await mock.sent()).emails.find((m) => toOf(m) === email);
    expect(mail.subject).toContain("You're on the waitlist");
    expect(mail.text).toContain("Place in line: 1");
    expect(mail.text).toMatch(/\/waitlist\/[a-f0-9]{48}/);
    // a customer record exists, and the team's list shows how many are waiting
    const { data: c } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email);
    expect(c).toHaveLength(1);
    // leaving takes two taps
    const token = page.url().match(/waitlist\/([a-f0-9]{48})/)![1];
    await page.getByRole("button", { name: "Leave the waitlist" }).click();
    await page.getByRole("button", { name: "Tap again to leave the waitlist" }).click();
    await expect(page.getByTestId("waitlist-title")).toHaveText("You left the waitlist");
    expect((await entry(token)).status).toBe("left");
    w.assertNone();
  });

  test("a cancellation books the first person waiting in, tells them once, and their page says so", async ({ page, browser }) => {
    const id = await session({ days: 6, capacity: 2 });
    const first = await join(id, "First");
    await join(id, "Second");
    const w1 = await wait(id, "Wendy One");
    const w2 = await wait(id, "Wally Two");
    // the first customer cancels from their booking page
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/booking/${first.token}`);
    await mock.clear();
    await p.getByRole("button", { name: /Cancel booking/ }).click();
    await p.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(p.getByText("Booking cancelled").first()).toBeVisible();
    await expect.poll(async () => (await entry(w1.token)).status, { timeout: 15_000 }).toBe("booked");
    expect((await entry(w2.token)).status).toBe("waiting");
    expect(await taken(id)).toBe(2);
    // the person booked in is told (the usual confirmation), exactly once; the other hears nothing
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === w1.email).length, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(1500);
    const mails = (await mock.sent()).emails.filter((m) => toOf(m) === w1.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/Confirmed/);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === w2.email)).toHaveLength(0);
    // their waitlist page now says they're in, with a link to the booking
    await page.goto(`/waitlist/${w1.token}`);
    await expect(page.getByTestId("waitlist-title")).toHaveText("You're booked in");
    await page.getByRole("link", { name: "View my booking" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
    await expect(page.getByText("Group Flow").first()).toBeVisible();
    // the second is now first in line
    await page.goto(`/waitlist/${w2.token}`);
    await expect(page.getByTestId("waitlist-position")).toContainText("Place in line: 1");
    await ctx.close();
  });

  test("the team sees the waitlist in order, can remove someone, and more spots book people in and tell them", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6, capacity: 2 });
    await join(id, "First");
    await join(id, "Second");
    await wait(id, "Wendy One");
    const w2 = await wait(id, "Wally Two");
    const w3 = await wait(id, "Wilma Three");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");
    const list = sheet.getByTestId("waitlist");
    await expect(list.getByText("Waitlist (3)")).toBeVisible();
    await expect(list.getByTestId("waiting").nth(0)).toContainText("Wendy One");
    await expect(list.getByTestId("waiting").nth(2)).toContainText("Wilma Three");
    // remove the middle one
    await list.getByTestId("waiting").filter({ hasText: "Wally Two" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Wally Two taken off the waitlist")).toBeVisible();
    await expect(list.getByText("Waitlist (2)")).toBeVisible();
    expect((await entry(w2.token)).status).toBe("removed");
    // two more spots: both remaining people are booked in, and told
    await mock.clear();
    await sheet.getByLabel("Spots", { exact: true }).fill("4");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Session updated")).toBeVisible();
    await expect(page.getByTestId("session-count")).toHaveText("4 of 4 booked");
    await expect(sheet.getByTestId("waitlist")).toHaveCount(0);
    expect((await entry(w3.token)).status).toBe("booked");
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => /Confirmed/.test(m.subject)).length, { timeout: 20_000 }).toBe(2);
  });

  test("cancelling the session lets the waiting people know", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6, capacity: 1 });
    await join(id, "Booked One");
    const w = await wait(id, "Wendy Waiter");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    await page.getByTestId("session-sheet").getByRole("button", { name: "Cancel this session" }).click();
    await mock.clear();
    await page.getByTestId("cancel-session").getByPlaceholder("Reason (optional)").fill("Instructor unwell");
    await page.getByTestId("cancel-session").getByRole("button", { name: "Yes, cancel session" }).click();
    await expect(page.getByText(/Session cancelled/)).toBeVisible();
    expect((await entry(w.token)).status).toBe("closed");
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === w.email).length, { timeout: 20_000 }).toBe(1);
    const mail = (await mock.sent()).emails.find((m) => toOf(m) === w.email);
    expect(mail.subject).toMatch(/Cancelled/);
    expect(mail.text).toContain("Instructor unwell");
  });

  test("a class that takes an online deposit offers no waitlist", async ({ page }) => {
    const id = await session({ days: 6, capacity: 1 });
    await join(id, "Booked One");
    await sb().from("services").update({ deposit_cents: 500 }).eq("id", svcId);
    await sb().from("organizations").update({ stripe_charges_enabled: true }).eq("id", S.orgA.id);
    try {
      await toSessions(page);
      const full = page.getByTestId("session-list").getByRole("button", { name: /full/ });
      await expect(full).toBeDisabled();
      await expect(full.getByText("Full", { exact: true })).toBeVisible();
    } finally {
      await sb().from("organizations").update({ stripe_charges_enabled: false }).eq("id", S.orgA.id);
      await sb().from("services").update({ deposit_cents: 0 }).eq("id", svcId);
    }
  });

  test("a waitlist page for a made-up link is not found", async ({ page }) => {
    const res = await page.goto(`/waitlist/${"x".repeat(48)}`);
    expect(res?.status()).toBe(404);
  });
});
