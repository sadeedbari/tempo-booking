// Shared helpers for the end-to-end scripts. Test data is always clearly tagged:
//   teams:  slug starts with "e2e-"      people: email ends with "@tempo-e2e.test"
// and removed again by cleanup.mjs. These scripts talk to the project in .env.local, so they refuse to run
// unless E2E_ALLOW_LIVE=1 is set on purpose.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");
export const STATE_FILE = path.join(here, ".state.json");
export const EMAIL_DOMAIN = "tempo-e2e.test";
export const SLUG_PREFIX = "e2e-";

export function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

export function guard() {
  if (process.env.E2E_ALLOW_LIVE !== "1") {
    console.error("These scripts create and delete tagged test data in the database from .env.local. Set E2E_ALLOW_LIVE=1 to run.");
    process.exit(2);
  }
}

const env = loadEnv();
export const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
export const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const anonClient = () => createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
export const secrets = { cron: env.CRON_SECRET, webhook: env.STRIPE_WEBHOOK_SECRET, trialClaim: env.TRIAL_CLAIM_SECRET };

/**
 * Creates a team for a test person, the way the app does (service role, on behalf of that person), so the one-trial-per-person
 * rule is exercised exactly as in production. Needs TRIAL_CLAIM_SECRET in .env.local.
 */
export async function createTeamFor(person, { name, slug, timezone, displayName }) {
  if (!secrets.trialClaim) throw new Error("Set TRIAL_CLAIM_SECRET in .env.local (the same value the app uses).");
  const { data, error } = await admin.rpc("create_organization_as", { p_uid: person.id, p_secret: secrets.trialClaim, p_name: name, p_slug: slug, p_timezone: timezone, p_display_name: displayName });
  if (error) throw new Error(`create team ${slug}: ${error.message}`);
  return data;
}

export const strongPassword = () => `E2e-${crypto.randomBytes(9).toString("base64url")}-9a!`;
export const emailFor = (name) => `e2e.${name}@${EMAIL_DOMAIN}`;

export async function createUser(name, password) {
  const email = emailFor(name);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return { id: data.user.id, email, password };
}

/** A client signed in as that person (so row-level security applies, exactly like the app). */
export async function signedIn(email, password) {
  const c = anonClient();
  // The hosted auth service limits sign-ins per address (about 30 per 5 minutes); wait it out instead of failing a whole run.
  for (let attempt = 0; ; attempt++) {
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (!error) return c;
    if (/rate limit/i.test(error.message) && attempt < 40) { await new Promise((r) => setTimeout(r, 15000)); continue; }
    throw new Error(`sign in ${email}: ${error.message}`);
  }
}

export async function cleanup() {
  // Find the test people first, so teams they created are removed even if their link doesn't start with "e2e".
  const testUsers = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error("cleanup: listUsers failed:", error.message); break; }
    if (!data.users.length) break;
    for (const u of data.users) if (u.email && u.email.endsWith(`@${EMAIL_DOMAIN}`)) testUsers.push(u);
    if (data.users.length < 200) break;
  }
  const ids = testUsers.map((u) => u.id);
  const found = new Map();
  const { data: bySlug } = await admin.from("organizations").select("id, slug").like("slug", `${SLUG_PREFIX}%`);
  for (const o of bySlug ?? []) found.set(o.id, o.slug);
  if (ids.length) {
    const { data: byOwner } = await admin.from("organizations").select("id, slug").in("created_by", ids);
    for (const o of byOwner ?? []) found.set(o.id, o.slug);
  }
  for (const [id, slug] of found) {
    const { error } = await admin.from("organizations").delete().eq("id", id);
    if (error) console.error("delete org", slug, error.message);
  }
  // The one-trial-per-person records (hashes only) outlive teams and accounts by design. Forget the test people's, or from the
  // second run on their new teams would start without a trial (D-015). Uses a service-role-only helper; needs TRIAL_CLAIM_SECRET.
  if (secrets.trialClaim) {
    for (const u of testUsers) {
      const { error } = await admin.rpc("forget_trial_claim", { p_secret: secrets.trialClaim, p_user: u.id, p_email: u.email });
      if (error) console.error("forget trial claim", u.email, error.message);
    }
  } else if (testUsers.length) {
    console.error("TRIAL_CLAIM_SECRET is not set in .env.local: trial records of the test people were NOT cleared.");
  }
  for (const u of testUsers) await admin.auth.admin.deleteUser(u.id);
  return found.size;
}

export const readState = () => JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
export const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

/* ---------- billing states for the browser specs ---------- */
export const MOCK_URL = "http://127.0.0.1:4010";
export const MOCK_PRICE = { base: "price_mock_base", location: "price_mock_location", pack: "price_mock_pack" };
const DAY = 86_400_000;

/**
 * Puts a test team's subscription row into a known state (service role, like the billing webhook would). States:
 *   trial            { days = 14 }                  trial with that many days left (whole days shown)
 *   trial-ended      { }                            trial that ended yesterday (reads as expired)
 *   none             { }                            a team with no trial and no plan (a second team of the same person)
 *   active           { extraLocations, staffPacks, periodDays = 30, cancelAtPeriodEnd }   paying; a matching subscription is created in the stand-in Stripe
 *   past-due         { extraLocations, staffPacks, daysAgo = 2 }    first failed payment `daysAgo` days ago (grace is 7)
 *   cancelled        { }                            subscription ended
 * Returns the row. Only ever used on teams the harness created.
 */
export async function setPlanState(orgId, state, o = {}) {
  const base = { stripe_customer_id: null, stripe_subscription_id: null, cancel_at_period_end: false, past_due_since: null, current_period_end: null, extra_locations: 0, staff_packs: 0, last_stripe_event_at: null, trial_reminder_sent_at: null, trial_ended_email_sent_at: null, stripe_missing_at: null, updated_at: new Date().toISOString() };
  let patch;
  if (state === "trial") patch = { ...base, status: "trial", trial_ends_at: new Date(Date.now() + ((o.days ?? 14) - 0.5) * DAY).toISOString() };
  else if (state === "trial-ended") patch = { ...base, status: "trial", trial_ends_at: new Date(Date.now() - DAY).toISOString() };
  else if (state === "none") {
    // Like private.organizations_start_trial() for a second team: inserted already expired, trial_ended_email_sent_at = trial_ends_at (so the page says "No active plan", not "Your trial has ended").
    const t = new Date(Date.now() - DAY).toISOString();
    patch = { ...base, status: "expired", trial_ends_at: t, trial_ended_email_sent_at: t };
  }
  else if (state === "cancelled") patch = { ...base, status: "cancelled", trial_ends_at: new Date(Date.now() - 20 * DAY).toISOString() };
  else if (state === "active" || state === "past-due") {
    const extra = o.extraLocations ?? 0;
    const packs = o.staffPacks ?? 0;
    const customer = `cus_e2e_${orgId.slice(0, 8)}`;
    const items = [{ price: MOCK_PRICE.base, quantity: 1 }, ...(extra ? [{ price: MOCK_PRICE.location, quantity: extra }] : []), ...(packs ? [{ price: MOCK_PRICE.pack, quantity: packs }] : [])];
    const r = await fetch(`${MOCK_URL}/__subscription`, { method: "POST", body: JSON.stringify({ customer, items, org: orgId, replace: true, status: state === "past-due" ? "past_due" : "active", cancel_at_period_end: Boolean(o.cancelAtPeriodEnd) }) });
    if (!r.ok) throw new Error("the stand-in Stripe (e2e/mock-services.mjs) is not running");
    const sub = await r.json();
    patch = {
      ...base, status: state === "active" ? "active" : "past_due", trial_ends_at: new Date(Date.now() - 20 * DAY).toISOString(),
      extra_locations: extra, staff_packs: packs, stripe_customer_id: customer, stripe_subscription_id: sub.id,
      current_period_end: new Date(Date.now() + (o.periodDays ?? 30) * DAY).toISOString(),
      cancel_at_period_end: Boolean(o.cancelAtPeriodEnd),
      past_due_since: state === "past-due" ? new Date(Date.now() - (o.daysAgo ?? 2) * DAY).toISOString() : null,
    };
  } else throw new Error(`unknown plan state ${state}`);
  const { data, error } = await admin.from("subscriptions").update(patch).eq("org_id", orgId).select("*").single();
  if (error) throw new Error(`setPlanState ${state}: ${error.message}`);
  return data;
}

/** Test-made rows that would otherwise change what the next test sees: extra team members, locations and pending invitations. */
export async function removeTestExtras(orgId) {
  await admin.from("invitations").delete().eq("org_id", orgId).is("accepted_at", null);
  await admin.from("memberships").delete().eq("org_id", orgId).is("user_id", null);
  await admin.from("locations").delete().eq("org_id", orgId).like("name", "E2E%");
}

/** Deletes the harness's own teams whose link starts with `prefix` (must start with "e2e"), and forgets a test person's one-trial record. */
export async function deleteTestOrgs(prefix) {
  if (!prefix.startsWith(SLUG_PREFIX.replace("-", ""))) throw new Error("only e2e teams may be deleted here");
  const { data } = await admin.from("organizations").select("id").like("slug", `${prefix}%`);
  for (const o of data ?? []) await admin.from("organizations").delete().eq("id", o.id);
  return data?.length ?? 0;
}
export async function forgetTrialClaimOf(person) {
  if (!person.email.endsWith(`@${EMAIL_DOMAIN}`)) throw new Error("only test people");
  if (!secrets.trialClaim) return;
  await admin.rpc("forget_trial_claim", { p_secret: secrets.trialClaim, p_user: person.id, p_email: person.email });
}
