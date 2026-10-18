import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const MOCK = "http://127.0.0.1:4010";
const state = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".state.json"), "utf8"));
export const S = state as {
  people: Record<"ownerA" | "adminA" | "staffA1" | "staffA2" | "ownerB" | "stranger", { id: string; email: string; password: string }>;
  orgA: { id: string; slug: string; members: Record<string, string>; locations: Record<string, string>; services: Record<string, string> };
  orgB: { id: string; slug: string; services: Record<string, string> };
};

export async function login(page: Page, who: keyof typeof S.people, next?: string) {
  // The hosted auth service limits sign-ins (about 30 per 5 minutes per address): if it says so, wait and try again.
  for (let attempt = 0; ; attempt++) {
    await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    await page.getByLabel("Email").fill(S.people[who].email);
    await page.getByLabel("Password").fill(S.people[who].password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
      return;
    } catch (e) {
      const limited = /rate limit|too many/i.test(await page.locator("body").innerText().catch(() => ""));
      if (!limited || attempt >= 8) throw e;
      await page.waitForTimeout(20_000);
    }
  }
}

export async function logout(page: Page) {
  await page.request.post("/auth/signout");
  await page.context().clearCookies();
}

export const mock = {
  async sent() {
    return (await (await fetch(`${MOCK}/__sent`)).json()) as { emails: any[]; sms: any[]; stripe: any[] };
  },
  async clear() { await fetch(`${MOCK}/__sent`, { method: "DELETE" }); },
  async mode(m: Record<string, string>) {
    await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify(m) });
  },
};

/** Fails the test if the page logged an uncaught error or a failed server action. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Download the React DevTools|Failed to load resource.*(40[134]|409)|hydrat/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  return { assertNone: () => expect(errors, errors.join("\n")).toEqual([]) };
}

/** Next Tuesday-or-later weekday date (YYYY-MM-DD) far enough ahead to be bookable. */
export function futureWeekday(daysAhead = 7, weekday?: number) {
  const d = new Date(Date.now() + daysAhead * 86400_000);
  if (weekday !== undefined) while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Clicks the nth bookable day on the calendar (moving to next month if needed). */
export async function pickDay(page: Page, nth: number) {
  const days = page.locator('button[aria-label^="20"]:not([disabled])');
  await expect(days.first()).toBeVisible({ timeout: 20_000 });
  let count = await days.count();
  if (count <= nth) {
    await page.locator("button:has(svg.lucide-chevron-right)").first().click();
    count = await days.count();
  }
  const el = days.nth(Math.min(nth, count - 1));
  const label = await el.getAttribute("aria-label");
  await el.click();
  return label as string;
}

export async function pickTime(page: Page, label: string | RegExp) {
  const btn = page.getByRole("button", { name: label, exact: typeof label === "string" }).first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
}

export interface Who { name?: string; email: string; phone?: string; notes?: string; consent?: boolean; address?: string; unit?: string }
export async function fillDetails(page: Page, w: Who) {
  await page.getByLabel("Full name").fill(w.name ?? "Test Customer");
  await page.getByLabel("Email").fill(w.email);
  if (w.phone !== undefined) await page.getByLabel("Phone").fill(w.phone);
  if (w.phone && w.consent === false) await page.getByRole("checkbox").uncheck();
  if (w.address) await page.getByLabel(/^Address/).fill(w.address);
  if (w.unit) await page.getByLabel(/Unit/).fill(w.unit);
  if (w.notes) await page.getByLabel("Anything we should know?").fill(w.notes);
}

let seq = 0;
export const customerEmail = (p = "cust") => `${p}.${Date.now().toString(36)}${++seq}@customers.tempo-e2e.test`;

import { createClient } from "@supabase/supabase-js";
import { TZDate } from "@date-fns/tz";

/** Creates a booking through the same public function the booking page uses; returns its private link token. */
export async function rpcBook(o: { day: string; time: string; service?: string; member?: string | null; location?: string | null; email?: string; name?: string; phone?: string; address?: string }) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  const [y, m, d] = o.day.split("-").map(Number);
  const [h, mi] = o.time.split(":").map(Number);
  const r = await sb.rpc("create_public_booking", {
    p_org: S.orgA.id,
    p_service: o.service ?? S.orgA.services.haircut,
    p_member: o.member === undefined ? S.orgA.members.sara : o.member,
    p_starts_at: new TZDate(y, m - 1, d, h, mi, 0, "America/Toronto").toISOString(),
    p_name: o.name ?? "Rpc Customer",
    p_email: o.email ?? customerEmail("rpc"),
    p_phone: o.phone ?? "",
    p_notes: "",
    p_location: o.location === undefined ? S.orgA.locations.qw : o.location,
    p_address: o.address ?? "",
  });
  if (r.error) throw new Error(`booking failed: ${r.error.message}`);
  return r.data as { id: string; manage_token: string; status: string; member_id: string };
}

/** A weekday this many days ahead (skips weekends) as YYYY-MM-DD. Different offsets give different days. */
export function dayAhead(n: number) {
  // the nth weekday from today, so different n always give different days
  const d = new Date();
  for (let left = n; left > 0; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) left--;
  }
  return d.toISOString().slice(0, 10);
}
