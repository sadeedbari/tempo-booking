// Shared helpers for the billing UI specs (23-29). Plan states are written with the service role (the same way the billing
// webhook does), money only ever moves in the stand-in Stripe (e2e/mock-services.mjs).
import { expect, type Page, type Locator } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MOCK, S } from "./helpers";

// lib.mjs is an ES module that uses import.meta, which the test runner's CommonJS loader can't load directly.
const esm = (f: string) => (new Function("u", "return import(u)") as (u: string) => Promise<any>)(pathToFileURL(path.join(__dirname, "..", f)).href);
let libP: Promise<any> | null = null;
const lib = () => (libP ??= esm("lib.mjs"));

export type PlanState = "trial" | "trial-ended" | "none" | "active" | "past-due" | "cancelled";
export interface PlanOpts { days?: number; extraLocations?: number; staffPacks?: number; periodDays?: number; cancelAtPeriodEnd?: boolean; daysAgo?: number }

export async function setPlan(orgId: string, state: PlanState, o: PlanOpts = {}) {
  return (await lib()).setPlanState(orgId, state, o) as Promise<Record<string, any>>;
}
export async function removeExtras(orgId: string) { await (await lib()).removeTestExtras(orgId); }
export async function admin() { return (await lib()).admin as import("@supabase/supabase-js").SupabaseClient; }
export async function subRow(orgId: string) {
  return (await (await admin()).from("subscriptions").select("*").eq("org_id", orgId).single()).data as Record<string, any>;
}
export const A = () => S.orgA.id;
export const B = () => S.orgB.id;
export const billingUrl = (slug: string) => `/o/${slug}/settings/billing`;

/** Put both seeded teams back where seed.mjs leaves them (A paying 3 extra locations + 2 packs, B on a fresh trial). */
export async function restoreSeedPlans() {
  await removeExtras(S.orgA.id);
  await removeExtras(S.orgB.id);
  await setPlan(S.orgA.id, "active", { extraLocations: 3, staffPacks: 2 });
  await setPlan(S.orgB.id, "trial", { days: 14 });
}

export const WIDTHS = [375, 768, 1280] as const;
export const sizeFor = (w: number) => ({ width: w, height: w === 375 ? 812 : w === 768 ? 1024 : 900 });

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

/** The stand-in Stripe: what Tempo asked for, and switches to make it fail. */
export const stripeMock = {
  async mode(m: Record<string, string>) { await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify(m) }); },
  async reset() { await stripeMock.mode({ checkout: "ok", portal: "ok", subupdate: "ok" }); },
  async calls(pathPart: string) {
    const sent = (await (await fetch(`${MOCK}/__sent`)).json()) as { stripe: { method: string; path: string; body: Record<string, string>; idem?: string | null }[] };
    return sent.stripe.filter((c) => c.path.includes(pathPart));
  },
};

/** The price shown in the plan chooser box (the live total). */
export const liveTotal = (page: Page) => page.locator('[aria-live="polite"]').filter({ hasText: "/month" }).first();
export const extraLocationsInput = (page: Page) => page.getByLabel("Extra locations");
export const staffPacksInput = (page: Page) => page.getByLabel("Staff packs (5 staff each)");
export async function choose(page: Page, extraLocations: number, packs: number) {
  await extraLocationsInput(page).fill(String(extraLocations));
  await staffPacksInput(page).fill(String(packs));
}

/** Everything that is visible text on the page body, for "does not leak" checks. */
export async function bodyText(page: Page) { return (await page.locator("body").innerText()).replace(/\s+/g, " "); }

/** Waits until the page has finished its navigation work (server action round trips settle). */
export async function settled(page: Page) { await page.waitForLoadState("networkidle"); }

/** Opens a page as a signed-in person at a width, ready to assert. */
export async function openAt(page: Page, width: number, url: string) {
  await page.setViewportSize(sizeFor(width));
  await page.goto(url);
}

/** Relative luminance contrast ratio of two CSS colours given as "rgb(...)" / "rgba(...)". Alpha of the foreground is blended over `behind`. */
export function contrast(fg: string, bg: string, behind = "rgb(255, 255, 255)") {
  const parse = (c: string) => {
    const m = c.match(/[\d.]+/g)!.map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
  };
  const over = (top: { r: number; g: number; b: number; a: number }, under: { r: number; g: number; b: number }) => ({
    r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a),
  });
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const base = parse(behind);
  const bgc = over(parse(bg), base);
  const fgc = over(parse(fg), bgc);
  const [l1, l2] = [lum(fgc), lum(bgc)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Resolves the computed text and background colours of an element (walking up to the first non-transparent background). */
export async function colours(el: Locator) {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node);
    // The test runner's browser may report color-mix() as "color(srgb ...)": paint it on a canvas to get plain rgba.
    const toRgba = (c: string) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const x = cv.getContext("2d")!; x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
    };
    // what is painted behind the element: the first ancestor with an opaque background (the page, when none)
    let under = "rgba(255, 255, 255, 1.000)";
    for (let p = node.parentElement; p; p = p.parentElement) {
      const c = toRgba(getComputedStyle(p).backgroundColor);
      if (/, (1|1\.000)\)$/.test(c)) { under = c; break; }
    }
    return { fg: toRgba(cs.color), bg: toRgba(cs.backgroundColor), under };
  });
}

/** A server-action request the browser made (the id Next gave the action, and the body it sent), so a test can send it again, altered. */
export interface ActionCall { url: string; headers: Record<string, string>; body: string }
export async function captureAction(page: Page, trigger: () => Promise<unknown>): Promise<ActionCall> {
  const seen = page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"]));
  await trigger();
  const r = await seen;
  return { url: r.url(), headers: r.headers(), body: r.postData() ?? "" };
}
/** Sends a captured action again from `page`'s session with a different body; returns the response text. */
export async function replayAction(page: Page, call: ActionCall, args: unknown[]): Promise<string> {
  const h: Record<string, string> = { "next-action": call.headers["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" };
  if (call.headers["next-router-state-tree"]) h["next-router-state-tree"] = call.headers["next-router-state-tree"];
  const res = await page.request.post(call.url, { headers: h, data: JSON.stringify(args) });
  return res.text();
}

export async function deleteTestOrgs(prefix: string) { return (await lib()).deleteTestOrgs(prefix) as Promise<number>; }
export async function forgetTrialClaimOf(person: { id: string; email: string }) { await (await lib()).forgetTrialClaimOf(person); }
export async function createTeamFor(person: { id: string; email: string; password: string }, o: { name: string; slug: string; timezone: string; displayName: string }) { return (await lib()).createTeamFor(person, o); }

/**
 * Starts a SECOND copy of the already-built Tempo on another port with different settings (for "billing not set up" cases the main
 * server can't show). Everything that could reach a real service is pointed at the stand-ins, exactly like e2e/dev-server.sh.
 * Returns a stop function; call it in afterAll.
 */
export async function startSecondServer(port: number, overrides: Record<string, string>) {
  const { spawn } = await import("node:child_process");
  const env: Record<string, string | undefined> = {
    ...process.env,
    TEMPO_E2E: "1",
    RESEND_API_KEY: "re_mock", RESEND_BASE_URL: MOCK,
    TWILIO_ACCOUNT_SID: "ACmock", TWILIO_AUTH_TOKEN: "mock", TWILIO_FROM_NUMBER: "+15005550006", TWILIO_API_BASE: MOCK,
    STRIPE_SECRET_KEY: "sk_test_mock", STRIPE_MOCK_URL: MOCK,
    STRIPE_PRICE_BASE: "price_mock_base", STRIPE_PRICE_EXTRA_LOCATION: "price_mock_location", STRIPE_PRICE_STAFF_PACK: "price_mock_pack",
    STRIPE_BILLING_WEBHOOK_SECRET: "whsec_e2e_billing_mock", STRIPE_PORTAL_CONFIGURATION: "bpc_mock_tempo",
    NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
    ...overrides,
  };
  const child = spawn(process.execPath, [path.join(__dirname, "..", "..", "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { cwd: path.join(__dirname, "..", ".."), env: env as NodeJS.ProcessEnv, stdio: "ignore" });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/login`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { base, stop: async () => { child.kill(); await new Promise((r) => setTimeout(r, 300)); } };
}
