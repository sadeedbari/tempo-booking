import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, mock, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;
let svcId = "";
let seriesSvc = "";

const dayKeyAhead = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const inDays = (days: number, hours = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(19 + hours, 0, 0, 0); return d.toISOString(); };
/** The instant of a Toronto clock hour on a date (the clocks change on the first Sunday of November). */
function torontoAt(key: string, hour: number) {
  for (const off of [4, 5]) {
    const d = new Date(`${key}T${String(hour + off).padStart(2, "0")}:00:00Z`);
    if (d.toLocaleString("en-US", { timeZone: "America/Toronto", hour: "numeric", hour12: false }) === String(hour)) return d;
  }
  throw new Error("no such hour");
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });

async function session(o: { days: number; capacity?: number; member?: string; series?: string; index?: number; hours?: number }) {
  const { data, error } = await sb()
    .from("class_sessions")
    .insert({ org_id: S.orgA.id, service_id: svcId, member_id: o.member ?? S.orgA.members.sara, location_id: S.orgA.locations.qw, starts_at: inDays(o.days, o.hours ?? 0), ends_at: inDays(o.days, (o.hours ?? 0) + 1), blocked_until: inDays(o.days, (o.hours ?? 0) + 1), capacity: o.capacity ?? 6, series_id: o.series ?? null, series_index: o.index ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
async function join(sessionId: string, name: string) {
  const email = customerEmail("cc");
  const { data, error } = await sb().rpc("create_public_session_booking", { p_org: S.orgA.id, p_session: sessionId, p_name: name, p_email: email, p_phone: "", p_notes: "" });
  if (error) throw new Error(error.message);
  return { email, bookingId: (data as { id: string }).id };
}
/** Four weekly sessions (6, 13, 20, 27 days ahead) in one series. */
async function weekly() {
  const series = crypto.randomUUID();
  const ids: string[] = [];
  for (const [i, d] of [6, 13, 20, 27].entries()) ids.push(await session({ days: d, series, index: i }));
  return { series, ids };
}
const sessionRow = async (id: string) => (await sb().from("class_sessions").select("starts_at, status, capacity, member_id").eq("id", id).single()).data!;
const spotsIn = async (id: string) => (await sb().from("bookings").select("id").eq("session_id", id).in("status", ["confirmed", "pending_approval"])).data!.length;

test.beforeAll(async () => {
  const c = sb();
  const a = await c.from("services").insert({ org_id: S.orgA.id, name: "Change Class", slug: "change-class", duration_minutes: 60, price_cents: 2000, is_class: true, class_capacity: 6, position: 90 }).select("id").single();
  if (a.error) throw new Error(a.error.message);
  svcId = a.data!.id;
  const b = await c.from("services").insert({ org_id: S.orgA.id, name: "Series Edit", slug: "series-edit", duration_minutes: 30, price_cents: 0, allow_series: true, auto_approve: true, position: 89 }).select("id").single();
  if (b.error) throw new Error(b.error.message);
  seriesSvc = b.data!.id;
});
test.beforeEach(async () => {
  await mock.clear();
  const c = sb();
  await c.from("bookings").delete().in("service_id", [svcId, seriesSvc]);
  await c.from("class_sessions").delete().eq("service_id", svcId);
  await c.from("booking_series").delete().eq("service_id", seriesSvc);
});
test.afterAll(async () => {
  const c = sb();
  await c.from("bookings").delete().in("service_id", [svcId, seriesSvc]);
  await c.from("class_sessions").delete().eq("service_id", svcId);
  await c.from("booking_series").delete().eq("service_id", seriesSvc);
  await c.from("services").delete().in("id", [svcId, seriesSvc]);
});

async function open(page: import("@playwright/test").Page, days: number, nth = 0) {
  await page.goto(`${base}/calendar?date=${dayKeyAhead(days)}`);
  await page.getByTestId("session-block").nth(nth).click();
  return page.getByTestId("session-sheet");
}

test.describe("moving a person", () => {
  test("to another session of the class: they're moved, told once, and the full session can't be picked", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const a = await session({ days: 6, capacity: 4 });
    const roomy = await session({ days: 8, capacity: 4 });
    const full = await session({ days: 9, capacity: 1 });
    await join(full, "Full House");
    const ann = await join(a, "Ann Attendee");
    await join(a, "Bo Booked");
    const sheet = await open(page, 6);
    const person = sheet.getByTestId("attendee").filter({ hasText: "Ann Attendee" });
    await person.getByRole("button", { name: "Move", exact: true }).click();
    const panel = person.getByTestId("move-person");
    // the full session is listed but can't be chosen
    await expect(panel.getByLabel("Move to").locator("option")).toHaveCount(3); // "Choose a session" and the two others
    const options = await panel.getByLabel("Move to").locator("option").allTextContents();
    expect(options.join(" | ")).toMatch(/full/);
    expect(await panel.getByLabel("Move to").locator("option", { hasText: "full" }).isDisabled()).toBe(true);
    await panel.getByLabel("Move to").selectOption(roomy);
    await mock.clear();
    await panel.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Ann Attendee moved")).toBeVisible();
    await expect(sheet.getByTestId("attendee")).toHaveCount(1);
    expect(await spotsIn(a)).toBe(1);
    expect(await spotsIn(roomy)).toBe(1);
    const { data: row } = await sb().from("bookings").select("session_id, starts_at").eq("id", ann.bookingId).single();
    expect(row!.session_id).toBe(roomy);
    expect(new Date(row!.starts_at).getTime()).toBe(new Date(inDays(8)).getTime());
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === ann.email).length, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(1200);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === ann.email)).toHaveLength(1);
    expect((await mock.sent()).emails.find((m) => toOf(m) === ann.email).subject).toMatch(/Rescheduled|Updated|Change/i);
    w.assertNone();
  });

  test("not telling them sends no email, and a session with no other dates says so", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const a = await session({ days: 6 });
    const ann = await join(a, "Ann Attendee");
    const sheet = await open(page, 6);
    const person = sheet.getByTestId("attendee").filter({ hasText: "Ann Attendee" });
    await person.getByRole("button", { name: "Move", exact: true }).click();
    await expect(person.getByText("There are no other upcoming sessions of this class.")).toBeVisible();
    await person.getByRole("button", { name: "Cancel" }).click();
    const b = await session({ days: 8 });
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByTestId("session-block").first().click();
    const p2 = page.getByTestId("session-sheet").getByTestId("attendee").filter({ hasText: "Ann Attendee" });
    await p2.getByRole("button", { name: "Move", exact: true }).click();
    const panel = p2.getByTestId("move-person");
    await panel.getByLabel("Move to").selectOption(b);
    await panel.getByRole("switch", { name: "Email them the new time" }).click();
    await mock.clear();
    await panel.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Ann Attendee moved")).toBeVisible();
    await page.waitForTimeout(2000);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === ann.email)).toHaveLength(0);
  });
});

test.describe("moving a session", () => {
  test("to a new time and instructor: everyone goes with it and is told", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const id = await session({ days: 6 });
    const ann = await join(id, "Ann Attendee");
    const bo = await join(id, "Bo Booked");
    const sheet = await open(page, 6);
    await sheet.getByRole("button", { name: "Move this session" }).click();
    const panel = sheet.getByTestId("reschedule-session");
    await expect(panel.getByText("2 people are booked and will move with it.")).toBeVisible();
    await panel.getByLabel("New time", { exact: true }).selectOption({ label: "5:00 PM" });
    await panel.getByLabel("Led by").selectOption({ label: "Sam Therapist" });
    await mock.clear();
    await panel.getByRole("button", { name: "Move session" }).click();
    const out = page.getByTestId("session-change-outcome");
    await expect(out.getByText(/1 session was moved/)).toBeVisible();
    await expect(out.getByText(/2 people were told/)).toBeVisible();
    await out.getByRole("button", { name: "Done" }).click();
    const row = await sessionRow(id);
    expect(clock(row.starts_at)).toBe("5:00 PM");
    expect(row.member_id).toBe(S.orgA.members.sam);
    const { data: bookings } = await sb().from("bookings").select("starts_at, member_id").eq("session_id", id);
    for (const b of bookings!) {
      expect(new Date(b.starts_at).getTime()).toBe(new Date(row.starts_at).getTime());
      expect(b.member_id).toBe(S.orgA.members.sam);
    }
    for (const p of [ann, bo]) await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === p.email).length, { timeout: 20_000 }).toBe(1);
    // the calendar shows it at the new time
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await expect(page.getByTestId("session-block")).toHaveCount(1);
    await expect(page.getByTestId("session-block").getByText("5:00 PM")).toBeVisible();
    w.assertNone();
  });

  test("onto the instructor's other class is refused with a plain message", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session({ days: 6 });
    await session({ days: 6, hours: 3 }); // 3 hours later the same day
    await join(id, "Ann Attendee");
    const sheet = await open(page, 6, 0);
    await sheet.getByRole("button", { name: "Move this session" }).click();
    const panel = sheet.getByTestId("reschedule-session");
    // the other class is at the same clock time + 3h; move this one onto it
    const target = clock(inDays(6, 3));
    await panel.getByLabel("New time", { exact: true }).selectOption({ label: target });
    await panel.getByRole("button", { name: "Move session" }).click();
    await expect(sheet.getByText(/overlap/i).first()).toBeVisible();
    expect(clock((await sessionRow(id)).starts_at)).toBe(clock(inDays(6)));
  });
});

test.describe("a weekly series", () => {
  test("shows where it sits, and 'also change later sessions' changes spots and notes in each", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const { ids } = await weekly();
    // the third session already has 5 people booked, so 4 spots can't fit there
    for (let i = 0; i < 5; i++) await join(ids[2], `Crowd ${i}`);
    const sheet = await open(page, 13);
    await expect(sheet.getByText("Repeating class")).toBeVisible();
    await expect(sheet.getByText("2 of 4")).toBeVisible();
    await sheet.getByLabel("Spots", { exact: true }).fill("4");
    await sheet.getByRole("switch", { name: "Also change the later sessions" }).click();
    await sheet.getByRole("button", { name: "Save changes" }).click();
    const out = page.getByTestId("session-change-outcome");
    await expect(out.getByText("2 sessions were updated.")).toBeVisible();
    await expect(out.getByText("1 session was left as it was")).toBeVisible();
    await expect(out.getByText(/already booked/)).toBeVisible();
    await out.getByRole("button", { name: "Done" }).click();
    expect((await sessionRow(ids[0])).capacity).toBe(6); // earlier ones untouched
    expect((await sessionRow(ids[1])).capacity).toBe(4);
    expect((await sessionRow(ids[2])).capacity).toBe(6); // couldn't shrink
    expect((await sessionRow(ids[3])).capacity).toBe(4);
  });

  test("moving 'this and later' keeps each date and takes the new time; one that clashes is skipped; each person is told", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const { ids } = await weekly();
    const a = await join(ids[1], "Ann Attendee");
    const b = await join(ids[3], "Bo Booked");
    // Sara already has something at 5 PM on the last date
    const { data: sess } = await sb().from("class_sessions").select("starts_at").eq("id", ids[3]).single();
    const lastLocalDate = new Date(sess!.starts_at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    const fiveToronto = torontoAt(lastLocalDate, 17); // a one-on-one booking at 5 PM that day
    const blockers = await sb().from("bookings").insert({ org_id: S.orgA.id, service_id: S.orgA.services.haircut, member_id: S.orgA.members.sara, starts_at: fiveToronto.toISOString(), ends_at: new Date(fiveToronto.getTime() + 1_800_000).toISOString(), blocked_until: new Date(fiveToronto.getTime() + 1_800_000).toISOString(), status: "confirmed", service_name: "Haircut" });
    expect(blockers.error).toBeNull();

    const sheet = await open(page, 13);
    await sheet.getByRole("button", { name: "Move this session" }).click();
    const panel = sheet.getByTestId("reschedule-session");
    await panel.getByRole("tab", { name: "This and 2 later" }).click();
    await expect(panel.getByText(/keep their dates/)).toBeVisible();
    await panel.getByLabel("New time", { exact: true }).selectOption({ label: "5:00 PM" });
    await mock.clear();
    await panel.getByRole("button", { name: "Move session" }).click();
    const out = page.getByTestId("session-change-outcome");
    await expect(out.getByText(/2 sessions were moved/)).toBeVisible();
    await expect(out.getByText(/1 person was told/)).toBeVisible();
    await expect(out.getByText("1 session was left as it was")).toBeVisible();
    await out.getByRole("button", { name: "Done" }).click();

    expect(clock((await sessionRow(ids[0])).starts_at)).toBe(clock(inDays(6))); // before: untouched
    expect(clock((await sessionRow(ids[1])).starts_at)).toBe("5:00 PM");
    expect(clock((await sessionRow(ids[2])).starts_at)).toBe("5:00 PM");
    expect(clock((await sessionRow(ids[3])).starts_at)).toBe(clock(inDays(27))); // clashed: left as it was
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === a.email).length, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(1200);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === b.email)).toHaveLength(0); // their session didn't move
    await sb().from("bookings").delete().eq("starts_at", fiveToronto.toISOString()).eq("service_id", S.orgA.services.haircut);
  });

  test("cancelling 'this and later' cancels every later session and tells each person", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const { ids } = await weekly();
    const first = await join(ids[0], "Early Eve");
    const second = await join(ids[1], "Ann Attendee");
    const third = await join(ids[2], "Cy Cancel");
    const sheet = await open(page, 13);
    await sheet.getByRole("button", { name: "Cancel this session" }).click();
    const panel = sheet.getByTestId("cancel-session");
    await panel.getByRole("tab", { name: "This and 2 later" }).click();
    await mock.clear();
    await panel.getByRole("button", { name: "Yes, cancel them" }).click();
    await expect(page.getByText(/3 sessions cancelled\. 2 people told\./)).toBeVisible();
    expect((await sessionRow(ids[0])).status).toBe("scheduled");
    for (const i of [1, 2, 3]) expect((await sessionRow(ids[i])).status).toBe("cancelled");
    expect(await spotsIn(ids[0])).toBe(1);
    for (const p of [second, third]) await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === p.email).length, { timeout: 20_000 }).toBe(1);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === first.email)).toHaveLength(0);
  });

  test("a series made from the New class form shares one series; a lone session shows no series options", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/calendar?date=${dayKeyAhead(6)}`);
    await page.getByRole("button", { name: "New class" }).click();
    const form = page.getByRole("dialog");
    await form.getByRole("button", { name: /Change Class/ }).click();
    await form.getByLabel("Date").fill(dayKeyAhead(6));
    await form.getByLabel("How often").selectOption({ label: "Every week" });
    await form.getByLabel("How many sessions").selectOption({ label: "3 sessions" });
    await form.getByRole("button", { name: "Add 3 sessions" }).click();
    await expect(page.getByTestId("session-outcome").getByText("3 sessions were added to the calendar.")).toBeVisible();
    await page.getByTestId("session-outcome").getByRole("button", { name: "Done" }).click();
    const { data } = await sb().from("class_sessions").select("series_id, series_index").eq("service_id", svcId).order("starts_at");
    expect(data).toHaveLength(3);
    expect(new Set(data!.map((r) => r.series_id)).size).toBe(1);
    expect(data!.map((r) => r.series_index)).toEqual([0, 1, 2]);
    // a lone session
    await sb().from("class_sessions").delete().eq("service_id", svcId);
    await session({ days: 6 });
    const sheet = await open(page, 6);
    await expect(sheet.getByText("Repeating class")).toHaveCount(0);
    await expect(sheet.getByRole("switch", { name: "Also change the later sessions" })).toHaveCount(0);
  });
});

test.describe("a repeating appointment", () => {
  test("changing 'this and later' moves each date to the new time and person, skips one that doesn't fit, and tells the customer once", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const email = customerEmail("rs");
    const first = new Date(Date.now() + 6 * 86_400_000);
    first.setUTCHours(14, 0, 0, 0);
    // four weekly dates for Sara through the real function the booking page uses
    const day = new Date(first);
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const key = day.toISOString().slice(0, 10);
    const startsAt = new Date(`${key}T14:00:00Z`).toISOString();
    const r = await sb().rpc("create_public_booking_series", { p_org: S.orgA.id, p_service: seriesSvc, p_member: S.orgA.members.sara, p_starts_at: startsAt, p_name: "Series Sam", p_email: email, p_phone: "", p_notes: "", p_location: S.orgA.locations.qw, p_address: "", p_interval_weeks: 1, p_count: 4 });
    if (r.error) throw new Error(r.error.message);
    const ids = (r.data as { booked: { id: string }[] }).booked.map((b) => b.id);
    expect(ids).toHaveLength(4);
    const { data: dates } = await sb().from("bookings").select("id, starts_at").eq("series_id", (r.data as { series_id: string }).series_id).order("starts_at");
    // Sam already has a booking at the new time on the last date
    const lastLocal = new Date(dates![3].starts_at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    const four = torontoAt(lastLocal, 16);
    const blocker = await sb().from("bookings").insert({ org_id: S.orgA.id, service_id: S.orgA.services.haircut, member_id: S.orgA.members.sam, starts_at: four.toISOString(), ends_at: new Date(four.getTime() + 1_800_000).toISOString(), blocked_until: new Date(four.getTime() + 1_800_000).toISOString(), status: "confirmed", service_name: "Haircut" });
    expect(blocker.error).toBeNull();

    // open the second date's booking from the Bookings list
    await page.goto(`${base}/bookings`);
    const dlg = page.getByRole("dialog");
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: /Series Sam/ }).nth(i).click();
      await dlg.getByText(/of 4 ·/).waitFor({ timeout: 8000 });
      if (await dlg.getByText("2 of 4 ·").count()) break;
      await page.keyboard.press("Escape");
    }
    await expect(dlg.getByText(/Repeating appointment/)).toBeVisible();
    await expect(dlg.getByText("2 of 4 ·")).toBeVisible();
    await dlg.getByRole("button", { name: "Reschedule" }).click();
    await dlg.getByRole("tab", { name: /This and 2 later/ }).click();
    await dlg.getByLabel("Time").selectOption({ label: "4:00 PM" });
    await dlg.getByLabel("With").selectOption({ label: "Sam Therapist" });
    await mock.clear();
    await dlg.getByRole("button", { name: "Save" }).click();
    const out = page.getByTestId("series-change-outcome");
    await expect(out.getByText(/2 appointments were updated/)).toBeVisible();
    await expect(out.getByText("1 date was left as it was")).toBeVisible();
    await out.getByRole("button", { name: "Done" }).click();

    const { data: after } = await sb().from("bookings").select("id, starts_at, member_id").eq("series_id", (r.data as { series_id: string }).series_id).order("starts_at");
    expect(clock(after![0].starts_at)).toBe(clock(dates![0].starts_at)); // the first date wasn't part of "this and later"
    expect(after![0].member_id).toBe(S.orgA.members.sara);
    for (const i of [1, 2]) {
      expect(clock(after![i].starts_at)).toBe("4:00 PM");
      expect(after![i].member_id).toBe(S.orgA.members.sam);
    }
    expect(after![3].member_id).toBe(S.orgA.members.sara); // the one that clashed stayed
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === email).length, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(1200);
    expect((await mock.sent()).emails.filter((m) => toOf(m) === email)).toHaveLength(1);
    await sb().from("bookings").delete().eq("starts_at", four.toISOString()).eq("service_id", S.orgA.services.haircut);
  });
});
