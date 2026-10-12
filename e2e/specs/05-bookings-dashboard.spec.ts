import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, dayAhead, mock, rpcBook, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const mailsTo = async (to: string) => (await mock.sent()).emails.filter((e) => ([] as string[]).concat(e.to).includes(to));
const status = async (id: string) => (await admin().from("bookings").select("status, payment_status").eq("id", id).single()).data!;

test.beforeEach(async () => { await mock.clear(); await mock.mode({ resend: "ok", twilio: "ok", refund: "ok" }); });

test.describe("adding bookings by hand (Calendar > New)", () => {
  test("a new customer is created with the booking and gets a confirmation", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/calendar`);
    await page.getByRole("button", { name: /New/ }).first().click();
    await expect(page.getByRole("heading", { name: "New booking" })).toBeVisible();
    await page.getByRole("button", { name: /^Haircut/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Sara Stylist/ }).click();
    await page.locator('input[type="date"]').fill(dayAhead(20));
    await page.locator("select").filter({ hasText: "9:00 AM" }).first().selectOption({ label: "10:00 AM" });
    await page.getByRole("dialog").getByText("New", { exact: true }).click({ timeout: 2500 }).catch(() => {}); // existing / new customer toggle (only shown once there are customers)
    const email = customerEmail("hand");
    await page.getByPlaceholder("Full name").fill("Hand Booked");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Phone (optional)").fill("647 555 0199");
    await page.getByRole("dialog").getByRole("button", { name: /Add booking|Create|Save|Book/ }).last().click();
    await expect(page.getByText("Booking added")).toBeVisible();
    await expect.poll(async () => (await mailsTo(email)).length, { timeout: 15_000 }).toBe(1);
    expect((await mailsTo(email))[0].subject).toBe("Confirmed: Haircut with E2E Salon");
    const { data } = await admin().from("customers").select("name, phone, sms_consent_at").eq("org_id", S.orgA.id).eq("email", email).single();
    expect(data!.name).toBe("Hand Booked");
    expect(data!.phone).toMatch(/647.*555.*0199/); // stored in a tidied-up form
    w.assertNone();
  });

  test("a booking on a closed day or at a taken time shows a clear message and nothing is saved", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const day = dayAhead(21);
    await rpcBook({ day, time: "10:00" });
    await page.goto(`${base}/calendar`);
    await page.getByRole("button", { name: /New/ }).first().click();
    await page.getByRole("button", { name: /^Haircut/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Sara Stylist/ }).click();
    await page.locator('input[type="date"]').fill(day);
    await page.locator("select").filter({ hasText: "9:00 AM" }).first().selectOption({ label: "10:00 AM" });
    await page.getByRole("dialog").getByText("New", { exact: true }).click({ timeout: 2500 }).catch(() => {});
    await page.getByPlaceholder("Full name").fill("Clash Person");
    await page.getByPlaceholder("Email").fill(customerEmail("clash"));
    await page.getByRole("dialog").getByRole("button", { name: /Add booking|Create|Save|Book/ }).last().click();
    await expect(page.getByText(/overlaps|taken|already/i).first()).toBeVisible();
    await expect(page.getByText("Booking added")).toHaveCount(0);
  });
});

test.describe("requests: approve and decline", () => {
  const request = (n: number, email = customerEmail("req")) => rpcBook({ day: dayAhead(n), time: "09:00", service: S.orgA.services.homevisit, member: S.orgA.members.sam, location: S.orgA.locations.le, address: "9 Request St, Toronto", email, name: `Request Person ${n}` }).then((b) => ({ ...b, email, name: `Request Person ${n}` }));

  test("approving confirms the booking and emails the customer", async ({ pageAs }) => {
    const b = await request(22);
    const page = await pageAs("ownerA");
    await page.goto(`${base}/bookings`);
    await expect(page.getByText(/awaiting|needs approval|request/i).first()).toBeVisible();
    await page.getByText(b.name).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Booking confirmed/)).toBeVisible();
    await expect.poll(async () => (await status(b.id)).status).toBe("confirmed");
    await expect.poll(async () => (await mailsTo(b.email)).length, { timeout: 15_000 }).toBe(1);
    expect((await mailsTo(b.email))[0].subject).toMatch(/^Confirmed:/);
  });

  test("declining cancels it and emails the customer", async ({ pageAs }) => {
    const b = await request(23);
    const page = await pageAs("ownerA");
    await page.goto(`${base}/bookings`);
    await page.getByText(b.name).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Tap to confirm" }).click(); // declining asks first
    await expect(page.getByText(/Request declined/)).toBeVisible();
    await expect.poll(async () => (await status(b.id)).status).toBe("cancelled");
    await expect.poll(async () => (await mailsTo(b.email)).length, { timeout: 15_000 }).toBe(1);
    expect((await mailsTo(b.email))[0].subject).toMatch(/^Update on your request/);
  });

  test("declining a request with a paid deposit refunds it; if Stripe fails the request stays and a message says why", async ({ pageAs }) => {
    const sb = admin();
    const ok = await request(24);
    const bad = await request(25);
    for (const b of [ok, bad]) await sb.from("bookings").update({ payment_status: "paid", deposit_cents: 5000, stripe_checkout_session_id: `cs_e2e_${b.id.slice(0, 6)}` }).eq("id", b.id);
    await sb.from("organizations").update({ stripe_account_id: "acct_e2e", stripe_charges_enabled: true }).eq("id", S.orgA.id);
    try {
      const page = await pageAs("ownerA");
      await mock.mode({ refund: "fail" });
      await page.goto(`${base}/bookings`);
      await page.getByText(ok.name).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Tap to confirm" }).click();
      await expect(page.getByText(/Refund failed|couldn.t be refunded|mock refund failure/i)).toBeVisible();
      expect((await status(ok.id)).status).toBe("pending_approval");
      // and once Stripe is back, the refund goes through
      await mock.mode({ refund: "ok" });
      await page.getByRole("dialog").getByRole("button", { name: /Decline|Tap to confirm/ }).click(); // already armed by the first try
      await expect(page.getByText(/Request declined/)).toBeVisible();
      const refunds = (await mock.sent()).stripe.filter((s) => s.path === "/v1/refunds");
      expect(refunds.length).toBeGreaterThan(0);
      expect(refunds[refunds.length - 1].account).toBe("acct_e2e");
    } finally {
      await sb.from("organizations").update({ stripe_account_id: null, stripe_charges_enabled: false }).eq("id", S.orgA.id);
    }
  });
});

test.describe("looking after a confirmed booking", () => {
  test("complete, no-show, cancel and undo each work, and cancelling emails the customer", async ({ pageAs }) => {
    // an appointment that already happened, so it lives under the Past tab
    const sb = admin();
    const email = customerEmail("life");
    const { data: c } = await sb.from("customers").insert({ org_id: S.orgA.id, name: "Lifecycle Lee", email }).select("id").single();
    const start = new Date(Date.now() - 4 * 3600_000);
    const end = new Date(start.getTime() + 3600_000);
    const { data: b } = await sb.from("bookings").insert({
      org_id: S.orgA.id, member_id: S.orgA.members.sara, service_id: S.orgA.services.haircut, service_name: "Haircut", customer_id: c!.id,
      starts_at: start.toISOString(), ends_at: end.toISOString(), blocked_until: end.toISOString(), status: "confirmed", price_cents: 8500, currency: "CAD", source: "manual", location_id: S.orgA.locations.qw,
    }).select("id").single();
    const page = await pageAs("ownerA");
    const open = async (tab = "past") => { await page.goto(`${base}/bookings?tab=${tab}`); await page.getByText("Lifecycle Lee").first().click(); };
    await open();
    await page.getByRole("button", { name: /Completed/ }).first().click();
    await expect.poll(async () => (await status(b!.id)).status).toBe("completed");
    await open();
    await page.getByRole("button", { name: /Undo/ }).click();
    await expect.poll(async () => (await status(b!.id)).status).toBe("confirmed");
    await open();
    await page.getByRole("button", { name: /No-show/ }).first().click();
    await expect.poll(async () => (await status(b!.id)).status).toBe("no_show");
    await open();
    await page.getByRole("button", { name: /Undo/ }).click();
    await expect.poll(async () => (await status(b!.id)).status).toBe("confirmed");
    await open();
    await page.getByRole("button", { name: /Cancel booking/ }).click();
    await expect.poll(async () => (await status(b!.id)).status).toBe("cancelled");
    await expect.poll(async () => (await mailsTo(email)).filter((e) => /^Cancelled:/.test(e.subject)).length, { timeout: 15_000 }).toBe(1);
    await open("cancelled"); // shows under Cancelled, with no way to restore a cancelled booking
    await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  });

  test("rescheduling from the booking sheet moves it, and a clash is refused politely", async ({ pageAs }) => {
    const email = customerEmail("move");
    const day = dayAhead(27);
    const b = await rpcBook({ day, time: "10:00", email, name: "Mover Max" });
    await rpcBook({ day, time: "14:00", name: "In The Way" });
    const page = await pageAs("ownerA");
    await page.goto(`${base}/bookings`);
    await page.getByText("Mover Max").first().click();
    await page.getByRole("button", { name: "Reschedule" }).click();
    await page.locator('input[type="date"]').fill(day);
    await page.locator("select").filter({ hasText: "10:00 AM" }).first().selectOption({ label: "2:00 PM" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/overlaps|taken|already/i).first()).toBeVisible();
    await page.locator("select").filter({ hasText: "2:00 PM" }).first().selectOption({ label: "3:00 PM" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Booking updated")).toBeVisible();
    await expect.poll(async () => (await mailsTo(email)).filter((e) => /^Updated:/.test(e.subject)).length, { timeout: 15_000 }).toBe(1);
  });

  test("the list's tabs and search narrow things down and never error", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/bookings`);
    for (const tab of ["Upcoming", "Past", "Cancelled", "All"]) {
      const t = page.getByRole("button", { name: new RegExp(`^${tab}`) });
      if (await t.count()) await t.first().click();
    }
    const search = page.getByPlaceholder("Search");
    await search.fill("zzz-nothing-matches");
    await expect(page.getByText(/Nothing here yet|No upcoming|No /).first()).toBeVisible();
    await search.fill("<script>alert(1)</script>");
    await search.fill("");
    w.assertNone();
  });
});

test.describe("staff see what they should", () => {
  test("a staff member's calendar and bookings load, without team controls", async ({ pageAs }) => {
    const page = await pageAs("staffA1");
    const w = watchErrors(page);
    for (const p of ["calendar", "bookings", "schedule", "availability", "team"]) {
      await page.goto(`${base}/${p}`);
      await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong/);
    }
    await page.goto(`${base}/services`);
    await expect(page.getByRole("button", { name: /New service|Create service/ })).toHaveCount(0);
    await page.goto(`${base}/settings`);
    await expect(page.getByText(/Only owners and admins/)).toBeVisible();
    await page.goto(`${base}/customers`);
    await expect(page.locator("body")).not.toContainText(/Application error/);
    await page.goto(`${base}/workflows`);
    await expect(page.getByText(/Only owners and admins/)).toBeVisible();
    w.assertNone();
  });
});
