import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, mock, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;
let svcId = "";

/** A date key `days` ahead; sessions are at 19:00 UTC, which is the same calendar day in Toronto. */
const dayKeyAhead = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const inDays = (days: number, hours = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(19 + hours, 0, 0, 0);
  return d.toISOString();
};
async function session(o: { days: number; capacity?: number; hours?: number; member?: string; notes?: string }) {
  const { data, error } = await sb()
    .from("class_sessions")
    .insert({ org_id: S.orgA.id, service_id: svcId, member_id: o.member ?? S.orgA.members.sara, location_id: S.orgA.locations.qw, starts_at: inDays(o.days, o.hours ?? 0), ends_at: inDays(o.days, (o.hours ?? 0) + 1), blocked_until: inDays(o.days, (o.hours ?? 0) + 1), capacity: o.capacity ?? 8, notes: o.notes ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
async function join(sessionId: string, name: string) {
  const email = customerEmail("tc");
  const { data, error } = await sb().rpc("create_public_session_booking", { p_org: S.orgA.id, p_session: sessionId, p_name: name, p_email: email, p_phone: "", p_notes: "" });
  if (error) throw new Error(error.message);
  return { email, bookingId: (data as { id: string }).id, token: (data as { manage_token: string }).manage_token };
}
const sessionRow = async (id: string) => (await sb().from("class_sessions").select("status, capacity, notes, cancel_reason").eq("id", id).single()).data!;
const statuses = async (sessionId: string) => (await sb().from("bookings").select("status, customer:customers(name)").eq("session_id", sessionId).order("created_at")).data!.map((r) => `${(r.customer as any).name}:${r.status}`);

test.beforeAll(async () => {
  const { data, error } = await sb().from("services").insert({ org_id: S.orgA.id, name: "Team Class", slug: "team-class", duration_minutes: 60, price_cents: 2000, is_class: true, class_capacity: 8, position: 94 }).select("id").single();
  if (error) throw new Error(error.message);
  svcId = data!.id;
});
test.beforeEach(async () => {
  await mock.clear();
  const c = sb();
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
});
test.afterAll(async () => {
  const c = sb();
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
  await c.from("services").delete().eq("id", svcId);
  await c.from("services").delete().eq("org_id", S.orgA.id).eq("slug", "studio-flow");
});

test.describe("setting up a class", () => {
  test("a service becomes a group class with a number of spots, and a session is added from its card", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/services`);
    await page.getByRole("button", { name: "New service" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name", { exact: true }).fill("Studio Flow");
    await expect(dlg.getByLabel("Spots per session")).toHaveCount(0);
    await dlg.getByRole("switch", { name: "This is a group class" }).click();
    await expect(dlg.getByText("Session length")).toBeVisible();
    await dlg.getByLabel("Spots per session").fill("6");
    // repeating appointments don't apply to a class
    await expect(dlg.getByRole("switch", { name: "Customers can book repeating appointments" })).toBeDisabled();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Service created")).toBeVisible();
    const card = page.getByRole("heading", { name: "Studio Flow", exact: true }).locator("xpath=ancestor::div[contains(@class,'group')][1]");
    await expect(card.getByText("Group class")).toBeVisible();
    await expect(card.getByText("6 spots")).toBeVisible();
    const row = (await sb().from("services").select("id, is_class, class_capacity, allow_series").eq("org_id", S.orgA.id).eq("slug", "studio-flow").single()).data!;
    expect(row).toMatchObject({ is_class: true, class_capacity: 6, allow_series: false });

    // add a session from the card: the number of spots starts at the class's usual
    await card.getByRole("button", { name: /Session/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "New class session" })).toBeVisible();
    await expect(sheet.getByLabel("Spots")).toHaveValue("6");
    await sheet.getByLabel("Date").fill(dayKeyAhead(12));
    await sheet.getByRole("button", { name: "Add session" }).click();
    await expect(page.getByText("Session added")).toBeVisible();
    const { data: sess } = await sb().from("class_sessions").select("capacity, status, service_id").eq("service_id", row.id);
    expect(sess).toEqual([{ capacity: 6, status: "scheduled", service_id: row.id }]);

    // it can't turn back into an ordinary service while it has sessions coming up
    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByRole("switch", { name: "This is a group class" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/1 upcoming session/)).toBeVisible();
    w.assertNone();
  });

  test("a repeating class adds each week, and a date that clashes is skipped and listed", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    // Sara already has a one-on-one booking at the second date's time
    // (the same Toronto clock time two weeks later: the clocks may change in between)
    const firstLocal = new Date(inDays(7));
    const [hh, mm] = firstLocal.toLocaleTimeString("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" }).split(":").map(Number);
    const secondKey = new Date(new Date(inDays(14)).getTime()).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    let second = "";
    for (const off of [4, 5]) {
      const d = new Date(`${secondKey}T${String(hh + off).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
      if (d.toLocaleTimeString("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" }) === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) { second = d.toISOString(); break; }
    }
    expect(second).not.toBe("");
    const { error } = await sb().from("bookings").insert({ org_id: S.orgA.id, service_id: S.orgA.services.haircut, member_id: S.orgA.members.sara, starts_at: second, ends_at: new Date(new Date(second).getTime() + 1_800_000).toISOString(), blocked_until: new Date(new Date(second).getTime() + 1_800_000).toISOString(), status: "confirmed", service_name: "Haircut" });
    expect(error).toBeNull();
    await page.goto(`${base}/calendar?date=${dayKeyAhead(7)}`);
    await page.getByRole("button", { name: "New class" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /Team Class/ }).click();
    await sheet.getByLabel("Date").fill(dayKeyAhead(7));
    await sheet.getByLabel("Time").selectOption(new Date(inDays(7)).toLocaleTimeString("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" }));
    await sheet.getByRole("button", { name: /Sara Stylist/ }).click();
    await sheet.getByLabel("How often").selectOption({ label: "Every week" });
    await sheet.getByLabel("How many sessions").selectOption({ label: "3 sessions" });
    await sheet.getByRole("button", { name: "Add 3 sessions" }).click();
    const out = page.getByTestId("session-outcome");
    await expect(out.getByText("2 sessions were added to the calendar.")).toBeVisible();
    await expect(out.getByText("1 date was skipped")).toBeVisible();
    await out.getByRole("button", { name: "Done" }).click();
    const { data } = await sb().from("class_sessions").select("id").eq("service_id", svcId);
    expect(data).toHaveLength(2);
    await sb().from("bookings").delete().eq("service_id", S.orgA.services.haircut).eq("starts_at", second);
  });

  test("the first session has to be in the future and not clash", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await session({ days: 5 });
    await page.goto(`${base}/calendar?date=${dayKeyAhead(5)}`);
    await page.getByRole("button", { name: "New class" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /Team Class/ }).click();
    await sheet.getByLabel("Date").fill(dayKeyAhead(5));
    await sheet.getByRole("button", { name: /Sara Stylist/ }).click();
    // same instructor, overlapping the existing 3 PM / 2 PM session
    const local = new Date(inDays(5)).toLocaleTimeString("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" });
    await sheet.getByLabel("Time").selectOption(local);
    await sheet.getByRole("button", { name: "Add session" }).click();
    await expect(sheet.getByText(/overlap|already/i).first()).toBeVisible();
    expect((await sb().from("class_sessions").select("id").eq("service_id", svcId)).data).toHaveLength(1);
    // a time that has already passed
    await sheet.getByLabel("Date").fill(dayKeyAhead(-1));
    await sheet.getByRole("button", { name: "Add session" }).click();
    await expect(sheet.getByText("Pick a time in the future.")).toBeVisible();
  });

  test("class services aren't offered when adding an ordinary booking", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/calendar`);
    await page.getByRole("button", { name: /^New$/ }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("heading", { name: "New booking" })).toBeVisible();
    await expect(dlg.getByRole("button", { name: /^Haircut/ })).toBeVisible();
    await expect(dlg.getByRole("button", { name: /Team Class/ })).toHaveCount(0);
  });
});

test.describe("running a class", () => {
  test("the calendar shows a session as one block with how many are booked, and its roster", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const id = await session({ days: 6, capacity: 8, notes: "Bring water" });
    const a = await join(id, "Ann Attendee");
    await join(id, "Bo Booked");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    // two spots, one block: the class isn't drawn once per person
    await expect(page.getByTestId("session-block")).toHaveCount(1);
    await expect(page.getByTestId("session-block").getByText("2/8")).toBeVisible();
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");
    await expect(page.getByTestId("session-count")).toHaveText("2 of 8 booked");
    await expect(sheet.getByText("Bring water").first()).toBeVisible();
    await expect(sheet.getByTestId("attendee")).toHaveCount(2);
    await expect(sheet.getByText("Ann Attendee")).toBeVisible();
    await expect(sheet.getByRole("link", { name: a.email })).toBeVisible();
    w.assertNone();
  });

  test("mark someone attended or a no-show, and remove someone (told once, spot freed)", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6, capacity: 3 });
    await join(id, "Ann Attendee");
    const bo = await join(id, "Bo Booked");
    await join(id, "Cy Cancel");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");
    const person = (n: string) => sheet.getByTestId("attendee").filter({ hasText: n });
    await person("Ann Attendee").getByRole("button", { name: "Attended" }).click();
    await expect(page.getByText("Ann Attendee marked as attended")).toBeVisible();
    await person("Bo Booked").getByRole("button", { name: "No-show" }).click();
    await expect(page.getByText("Bo Booked marked as a no-show")).toBeVisible();
    expect(await statuses(id)).toEqual(["Ann Attendee:completed", "Bo Booked:no_show", "Cy Cancel:confirmed"]);

    await mock.clear();
    await person("Cy Cancel").getByRole("button", { name: "Remove" }).click();
    await person("Cy Cancel").getByRole("button", { name: "Tap to confirm" }).click();
    await expect(page.getByText("Cy Cancel removed")).toBeVisible();
    expect(await statuses(id)).toContain("Cy Cancel:cancelled");
    await expect(sheet.getByTestId("attendee")).toHaveCount(2);
    await expect(sheet.getByText("Cancelled (1)")).toBeVisible();
    // an undo is possible for a mark; the cancelled person's email went out once
    await person("Bo Booked").getByRole("button", { name: /Undo/ }).click();
    await expect(page.getByText("Bo Booked restored")).toBeVisible();
    expect(bo.email).toContain("@");
  });

  test("add a walk-in or an existing customer; a full class and a double add are refused; more spots make room", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6, capacity: 2 });
    await join(id, "Ann Attendee");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");

    // a brand-new person
    await sheet.getByRole("button", { name: "Add someone" }).click();
    const add = sheet.getByTestId("add-person");
    const newTab = add.getByRole("tab", { name: "New", exact: true });
    if (await newTab.count()) await newTab.click();
    const email = customerEmail("walk");
    await add.getByPlaceholder("Full name").fill("Wes Walkin");
    await add.getByPlaceholder("Email").fill(email);
    await add.getByRole("button", { name: "Add to session" }).click();
    await expect(page.getByText("Added to the session")).toBeVisible();
    await expect(page.getByTestId("session-count")).toHaveText("2 of 2 booked");
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBe(1);

    // now it's full
    await expect(sheet.getByRole("button", { name: "Add someone (full)" })).toBeVisible();
    await sheet.getByRole("button", { name: /Add someone/ }).click();
    await expect(sheet.getByText(/This session is full/)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Add to session" })).toBeDisabled();
    await sheet.getByTestId("add-person").getByRole("button", { name: "Cancel" }).click();

    // more spots, then the same person again is refused
    await sheet.getByLabel("Spots", { exact: true }).fill("3");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Session updated")).toBeVisible();
    await expect(page.getByTestId("session-count")).toHaveText("2 of 3 booked");
    await sheet.getByRole("button", { name: "Add someone" }).click();
    const add2 = sheet.getByTestId("add-person");
    const newTab2 = add2.getByRole("tab", { name: "New", exact: true });
    if (await newTab2.count()) await newTab2.click();
    await add2.getByPlaceholder("Full name").fill("Wes Walkin");
    await add2.getByPlaceholder("Email").fill(email);
    await add2.getByRole("button", { name: "Add to session" }).click();
    await expect(sheet.getByText("That person is already in this session.")).toBeVisible();
    expect(await sessionRow(id)).toMatchObject({ capacity: 3, status: "scheduled" });
  });

  test("spots can't go below who is booked, and notes are saved", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6, capacity: 5 });
    await join(id, "Ann Attendee");
    await join(id, "Bo Booked");
    await join(id, "Cy Cancel");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");
    await sheet.getByLabel("Spots", { exact: true }).fill("2");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet.getByText(/3 people are already booked/)).toBeVisible();
    await sheet.getByLabel("Spots", { exact: true }).fill("4");
    await sheet.getByLabel("Notes for customers").fill("Bring a towel");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Session updated")).toBeVisible();
    expect(await sessionRow(id)).toMatchObject({ capacity: 4, notes: "Bring a towel" });
  });

  test("cancelling a session cancels every spot, tells each person once, and takes the block off the calendar", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const id = await session({ days: 6 });
    const a = await join(id, "Ann Attendee");
    const b = await join(id, "Bo Booked");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    const sheet = page.getByTestId("session-sheet");
    await sheet.getByRole("button", { name: "Cancel this session" }).click();
    const panel = sheet.getByTestId("cancel-session");
    await expect(panel.getByText("2 people's spots are cancelled")).toBeVisible();
    await mock.clear();
    await panel.getByPlaceholder("Reason (optional)").fill("Instructor is unwell");
    await panel.getByRole("button", { name: "Yes, cancel session" }).click();
    await expect(page.getByText("Session cancelled. 2 people told.")).toBeVisible();
    expect(await sessionRow(id)).toMatchObject({ status: "cancelled", cancel_reason: "Instructor is unwell" });
    expect(await statuses(id)).toEqual(["Ann Attendee:cancelled", "Bo Booked:cancelled"]);
    for (const p of [a, b]) {
      await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === p.email).length, { timeout: 20_000 }).toBe(1);
    }
    await page.waitForTimeout(1500);
    for (const p of [a, b]) expect((await mock.sent()).emails.filter((m) => toOf(m) === p.email)).toHaveLength(1);
    await expect(page.getByTestId("session-block")).toHaveCount(0);
    // the instructor is free again, and the customer's page says it's cancelled
    const again = await sb().from("class_sessions").insert({ org_id: S.orgA.id, service_id: svcId, member_id: S.orgA.members.sara, starts_at: inDays(6), ends_at: inDays(6, 1), blocked_until: inDays(6, 1), capacity: 4 });
    expect(again.error).toBeNull();
    await page.goto(`/booking/${a.token}`);
    await expect(page.getByText(/cancelled/i).first()).toBeVisible();
    w.assertNone();
  });

  test("a cancelled session without telling anyone sends no email", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6 });
    const a = await join(id, "Ann Attendee");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").click();
    await page.getByTestId("session-sheet").getByRole("button", { name: "Cancel this session" }).click();
    const panel = page.getByTestId("cancel-session");
    await mock.clear();
    await panel.getByRole("switch", { name: "Tell everyone by email" }).click();
    await panel.getByRole("button", { name: "Yes, cancel session" }).click();
    await expect(page.getByText(/Session cancelled/)).toBeVisible();
    await page.waitForTimeout(2000);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === a.email)).toHaveLength(0);
    expect(await statuses(id)).toEqual(["Ann Attendee:cancelled"]);
  });

  test("a class spot in the Bookings list opens without a Reschedule button", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6 });
    await join(id, "Rita Roster");
    await page.goto(`${base}/bookings`);
    await page.getByRole("button", { name: /Rita Roster/ }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText("Group class")).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: "Cancel booking" })).toBeVisible();
  });

  test("staff can run a class too, and a past session can only be marked", async ({ pageAs }) => {
    const staff = await pageAs("staffA1");
    const id = await session({ days: 6 });
    await join(id, "Ann Attendee");
    await staff.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await staff.getByTestId("session-block").click();
    await expect(staff.getByTestId("session-sheet").getByTestId("attendee")).toHaveCount(1);
    await staff.getByTestId("session-sheet").getByRole("button", { name: "Add someone" }).click();
    await expect(staff.getByTestId("add-person")).toBeVisible();

    // a session that has already finished: attendance only
    const past = await session({ days: -2 });
    const c = sb();
    const { data: cust } = await c.from("customers").insert({ org_id: S.orgA.id, name: "Pat Past", email: customerEmail("past") }).select("id").single();
    await c.from("bookings").insert({ org_id: S.orgA.id, session_id: past, customer_id: cust!.id, status: "confirmed", service_name: "Team Class", member_id: S.orgA.members.sara, starts_at: inDays(-2), ends_at: inDays(-2, 1), blocked_until: inDays(-2, 1) });
    const owner = await pageAs("ownerA");
    await owner.goto(`${base}/calendar?date=${dayKeyAhead(-2)}`);
    await owner.getByTestId("session-block").click();
    const sheet = owner.getByTestId("session-sheet");
    await expect(sheet.getByRole("button", { name: "Attended" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Add someone" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Cancel this session" })).toHaveCount(0);
  });
});
