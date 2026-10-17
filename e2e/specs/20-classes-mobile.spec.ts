import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, S } from "./helpers";

/** Phone-sized pass for the class screens: nothing scrolls sideways, inputs don't trigger zoom, tap targets aren't tiny. */
const base = `/o/${S.orgA.slug}`;
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let svcId = "";
let sessionId = "";
const day = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 9); return d; })();

async function audit(page: import("@playwright/test").Page, scope = "body") {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const doc = document.documentElement;
    const small = [...root.querySelectorAll<HTMLElement>("button,select,input,textarea,[role=switch]")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !(e instanceof HTMLInputElement && ["hidden", "checkbox", "radio"].includes(e.type));
      })
      .map((e) => ({ t: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((x) => x.h < 30);
    const smallText = [...root.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea")]
      .filter((e) => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => e.getAttribute("aria-label") || e.getAttribute("name") || e.tagName);
    return { overflow: doc.scrollWidth - doc.clientWidth, small, smallText };
  }, scope);
}

test.beforeAll(async () => {
  const c = sb();
  const { data, error } = await c.from("services").insert({ org_id: S.orgA.id, name: "Phone Class", slug: "phone-class", duration_minutes: 60, price_cents: 2000, is_class: true, class_capacity: 8, position: 93 }).select("id").single();
  if (error) throw new Error(error.message);
  svcId = data!.id;
  const start = new Date(day); start.setUTCHours(19, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  const s = await c.from("class_sessions").insert({ org_id: S.orgA.id, service_id: svcId, member_id: S.orgA.members.sara, location_id: S.orgA.locations.qw, starts_at: start.toISOString(), ends_at: end.toISOString(), blocked_until: end.toISOString(), capacity: 8, notes: "Bring a mat" }).select("id").single();
  if (s.error) throw new Error(s.error.message);
  sessionId = s.data!.id;
  for (const name of ["Ann Attendee", "Bo Booked"]) {
    const r = await c.rpc("create_public_session_booking", { p_org: S.orgA.id, p_session: sessionId, p_name: name, p_email: customerEmail("ph"), p_phone: "", p_notes: "" });
    if (r.error) throw new Error(r.error.message);
  }
});
test.afterAll(async () => {
  const c = sb();
  await c.from("bookings").delete().eq("service_id", svcId);
  await c.from("class_sessions").delete().eq("service_id", svcId);
  await c.from("services").delete().eq("id", svcId);
});

test("on a phone: the calendar, a session's roster and the new-class form fit the screen", async ({ pageAs }) => {
  const page = await pageAs("ownerA");
  await page.goto(`${base}/calendar?date=${day.toISOString().slice(0, 10)}`);
  await expect(page.getByTestId("session-block")).toBeVisible();
  let a = await audit(page);
  expect(a.overflow, "calendar scrolls sideways").toBeLessThanOrEqual(1);

  await page.getByTestId("session-block").click();
  const sheet = page.getByTestId("session-sheet");
  await expect(sheet.getByTestId("attendee")).toHaveCount(2);
  await page.waitForTimeout(500);
  a = await audit(page, "[role=dialog]");
  expect(a.smallText, "inputs under 16px zoom on iPhone").toEqual([]);
  expect(a.small, "tiny buttons in the roster").toEqual([]);
  expect((await audit(page)).overflow, "roster scrolls sideways").toBeLessThanOrEqual(1);
  await sheet.getByRole("button", { name: "Add someone" }).click();
  await page.waitForTimeout(300);
  a = await audit(page, "[role=dialog]");
  expect(a.smallText).toEqual([]);
  expect(a.small, "tiny buttons in the add form").toEqual([]);
  await sheet.getByTestId("add-person").getByRole("button", { name: "Cancel" }).click();
  await sheet.getByRole("button", { name: "Move this session" }).click();
  await page.waitForTimeout(300);
  a = await audit(page, "[role=dialog]");
  expect(a.smallText, "inputs under 16px zoom on iPhone").toEqual([]);
  expect(a.small, "tiny buttons in the move form").toEqual([]);
  expect((await audit(page)).overflow, "move form scrolls sideways").toBeLessThanOrEqual(1);
  await sheet.getByTestId("reschedule-session").getByRole("button", { name: "Back" }).click();
  await sheet.getByTestId("attendee").first().getByRole("button", { name: "Move", exact: true }).click();
  await page.waitForTimeout(400);
  a = await audit(page, "[role=dialog]");
  expect(a.smallText, "inputs under 16px zoom on iPhone").toEqual([]);
  expect(a.small, "tiny buttons in the move-person form").toEqual([]);

  await page.goto(`${base}/calendar?date=${day.toISOString().slice(0, 10)}`);
  await page.getByRole("button", { name: "New class" }).click();
  await page.waitForTimeout(500);
  a = await audit(page, "[role=dialog]");
  expect(a.smallText, "inputs under 16px zoom on iPhone").toEqual([]);
  expect(a.small, "tiny buttons in the new-class form").toEqual([]);
  expect((await audit(page)).overflow).toBeLessThanOrEqual(1);

  await page.goto(`${base}/services`);
  await page.waitForTimeout(500);
  a = await audit(page);
  expect(a.overflow, "services scrolls sideways").toBeLessThanOrEqual(1);
});
