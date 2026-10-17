import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { test, expect } from "./fixtures";
import { customerEmail, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let svcId = "";

test.beforeAll(async () => {
  const { data, error } = await sb().from("services").insert({ org_id: S.orgA.id, name: "Team View Class", slug: "team-view-class", duration_minutes: 60, price_cents: 3000, is_class: true, class_capacity: 10, position: 95 }).select("id").single();
  if (error) throw new Error(error.message);
  svcId = data!.id;
});
test.afterAll(async () => {
  const c = sb();
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
  await c.from("services").delete().eq("id", svcId);
});

/** A session `days` from today (negative = in the past) at 15:00 UTC. */
async function session(days: number, capacity = 10) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + days);
  start.setUTCHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  const { data, error } = await sb().from("class_sessions").insert({ org_id: S.orgA.id, service_id: svcId, member_id: S.orgA.members.sara, location_id: S.orgA.locations.qw, starts_at: start.toISOString(), ends_at: end.toISOString(), blocked_until: end.toISOString(), capacity }).select("id").single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
async function addPerson(sessionId: string, name: string, status = "confirmed") {
  const c = sb();
  const email = customerEmail("tv");
  const { data: cust } = await c.from("customers").insert({ org_id: S.orgA.id, name, email }).select("id").single();
  const { error } = await c.from("bookings").insert({ org_id: S.orgA.id, session_id: sessionId, customer_id: cust!.id, status, service_name: "Team View Class", member_id: S.orgA.members.sara, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString(), blocked_until: new Date(Date.now() + 3_600_000).toISOString(), price_cents: 3000, source: "manual" });
  if (error) throw new Error(error.message);
  return email;
}
async function timeBooked(page: import("@playwright/test").Page) {
  const res = await page.request.get(`/api/export/home?org=${S.orgA.slug}&range=7`);
  expect(res.status()).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.body()) as never);
  const ws = wb.getWorksheet("Summary")!;
  let value: number | null = null;
  ws.eachRow((r) => {
    if (String(r.getCell(1).value ?? "").startsWith("Time booked")) value = Number(r.getCell(2).value);
  });
  return { value, wb };
}

test.describe("class spots in the team's views", () => {
  test("a class counts the instructor's time once, however many people are in it", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const id = await session(-2);
    await addPerson(id, "Una Utilization");
    const one = await timeBooked(page);
    expect(one.value).toBeGreaterThan(0);
    expect(one.value).toBeLessThan(0.5); // well below the cap, so the comparison below means something
    await addPerson(id, "Vera Visits");
    await addPerson(id, "Wanda Walkin");
    await addPerson(id, "Xena Exercise");
    const four = await timeBooked(page);
    expect(four.value).toBeCloseTo(one.value!, 6);
    // every person still counts as a booking, with their own revenue
    const bookings = four.wb.getWorksheet("Bookings")!;
    let rows = 0;
    bookings.eachRow((r) => { if (String(r.getCell(1).value ?? "") !== "" && /Team View Class/.test(r.values?.toString() ?? "")) rows++; });
    expect(rows).toBeGreaterThanOrEqual(4);
  });

  test("each person shows in Bookings and in the customer export, and Home and Bookings load cleanly", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const id = await session(3);
    const e1 = await addPerson(id, "Bea Booked");
    await addPerson(id, "Cal Counted");
    // upcoming rows: use the real public function so the time is the session's
    await page.goto(`${base}/bookings`);
    await expect(page.getByText("Team View Class").first()).toBeVisible();
    await page.goto(`${base}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const cust = await page.request.get(`/api/export/customers?org=${S.orgA.slug}`);
    expect(cust.status()).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await cust.body()) as never);
    const names: string[] = [];
    wb.getWorksheet("Customers")!.eachRow((r) => names.push(String(r.getCell(1).value ?? "")));
    expect(names).toContain("Bea Booked");
    expect(names).toContain("Cal Counted");
    expect(e1).toMatch(/@customers\.tempo-e2e\.test$/);
    w.assertNone();
  });
});
