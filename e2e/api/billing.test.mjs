// Subscription billing: plan limits and expiry enforced by the database, the billing webhook (signature, replay,
// order), failed payments, and the hourly job's trial emails. Runs against the local Tempo from e2e/dev-server.sh,
// whose Stripe and email are stand-ins (e2e/mock-services.mjs). Team A has a paid plan (4 locations, 30 staff
// allowed, set in seed.mjs); team B is on the trial (1 location, 5 staff).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { admin, APP, MOCK, mock, pub, signedIn, st } from "./util.mjs";
import { secrets } from "../lib.mjs";

const SECRET = "whsec_e2e_billing_mock"; // same value as e2e/dev-server.sh
const PRICE = { base: "price_mock_base", location: "price_mock_location", pack: "price_mock_pack" };
const DAY = 86_400_000;
const B = st.orgB.id;
const ownerB = await signedIn(st.people.ownerB.email, st.people.ownerB.password);
const adminA = await signedIn(st.people.adminA.email, st.people.adminA.password);
const ownerA = await signedIn(st.people.ownerA.email, st.people.ownerA.password);

const sub = (patch) => admin.from("subscriptions").update(patch).eq("org_id", B);
const row = async (org = B) => (await admin.from("subscriptions").select("*").eq("org_id", org).single()).data;
const cron = () => fetch(`${APP}/api/cron/reminders`, { headers: { Authorization: `Bearer ${secrets.cron}` } });

/** A signed Stripe event, as Stripe would deliver it. */
async function send(type, object, { secret = SECRET, id, created = Math.floor(Date.now() / 1000), badSig = false } = {}) {
  const event = { id: id ?? `evt_${crypto.randomUUID()}`, object: "event", type, created, data: { object } };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const res = await fetch(`${APP}/api/stripe/billing-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${badSig ? "0".repeat(64) : v1}` },
    body: payload,
  });
  return { status: res.status, body: await res.text(), event };
}
async function mockSub(customer, items, extra = {}) {
  const r = await fetch(`${MOCK}/__subscription`, { method: "POST", body: JSON.stringify({ customer, items, org: B, ...extra }) });
  return r.json();
}
// The webhook re-reads the subscription from Stripe (it never trusts the event), so change the stand-in Stripe's copy first.
const setStripe = (id, patch) => fetch(`${MOCK}/__subscription/${id}`, { method: "POST", body: JSON.stringify(patch) }).then((r) => r.json());
const items = (locations = 0, packs = 0) => [{ price: PRICE.base, quantity: 1 }, ...(locations ? [{ price: PRICE.location, quantity: locations }] : []), ...(packs ? [{ price: PRICE.pack, quantity: packs }] : [])];
const addMember = (name) => ownerB.rpc("add_team_member", { p_org: B, p_name: name, p_title: "", p_email: "", p_color: "#007AFF" });
const invoice = (id, customer, subscription) => ({ id, customer, parent: { subscription_details: { subscription } } });

beforeEach(async () => {
  await mock.clear();
  // team B back to a fresh trial with only its owner and no extra locations
  await sub({ status: "trial", trial_ends_at: new Date(Date.now() + 14 * DAY).toISOString(), current_period_end: null, extra_locations: 0, staff_packs: 0, stripe_customer_id: null, stripe_subscription_id: null, cancel_at_period_end: false, past_due_since: null, last_stripe_event_at: null, trial_reminder_sent_at: null, trial_ended_email_sent_at: null });
  await admin.from("memberships").delete().eq("org_id", B).is("user_id", null);
  await admin.from("locations").delete().eq("org_id", B);
  await admin.from("stripe_billing_events").delete().like("id", "evt_%");
});

test("every business has a trial; people can read at most their own, and nobody can write it", async () => {
  const mine = await ownerB.from("subscriptions").select("*");
  assert.equal(mine.data.length, 1);
  assert.equal(mine.data[0].org_id, B);
  assert.equal(mine.data[0].status, "trial");
  const days = (new Date(mine.data[0].trial_ends_at) - Date.now()) / DAY;
  assert.ok(days > 13 && days <= 14, `trial length ${days}`);
  // only owners may read the row: an admin of team A sees nothing, an owner of A sees only A's
  assert.equal((await adminA.from("subscriptions").select("*")).data.length, 0);
  assert.deepEqual((await ownerA.from("subscriptions").select("org_id")).data.map((r) => r.org_id), [st.orgA.id]);
  // no writes through the API, whatever the role
  const upd = await ownerB.from("subscriptions").update({ status: "active", extra_locations: 50 }).eq("org_id", B).select();
  assert.ok(upd.error || upd.data.length === 0, "owner must not update the subscription");
  const ins = await ownerB.from("subscriptions").insert({ org_id: B, trial_ends_at: new Date().toISOString() });
  assert.ok(ins.error, "insert must fail");
  const del = await ownerB.from("subscriptions").delete().eq("org_id", B).select();
  assert.ok(del.error || del.data.length === 0);
  assert.equal((await row()).status, "trial");
  assert.equal((await pub.from("subscriptions").select("*")).data?.length ?? 0, 0);
  const events = await ownerB.from("stripe_billing_events").select("*");
  assert.ok(events.error || events.data.length === 0, "webhook log is private");
});

test("the trial allows 1 location and 5 staff; the database refuses more, however it is called", async () => {
  const loc = (name, active = true) => ownerB.from("locations").insert({ org_id: B, name, active });
  assert.equal((await loc("First")).error, null);
  const second = await loc("Second");
  assert.ok(second.error, "second location on the trial must be refused");
  assert.match(second.error.message, /plan includes 1 location/i);
  // a hidden location doesn't use a place, and can't be switched back on beyond the limit
  assert.equal((await loc("Hidden", false)).error, null);
  const reactivate = await ownerB.from("locations").update({ active: true }).eq("org_id", B).eq("name", "Hidden");
  assert.ok(reactivate.error, "reactivating beyond the limit must be refused");

  // owner + 4 more = 5; every membership counts, with or without a login
  for (let i = 0; i < 4; i++) {
    const r = await addMember(`Helper ${i}`);
    assert.equal(r.error, null, r.error?.message);
  }
  const sixth = await addMember("One too many");
  assert.ok(sixth.error);
  assert.match(sixth.error.message, /plan includes 5 staff/i);
  // even the service role (a webhook, a script) goes through the same trigger
  const direct = await admin.from("memberships").insert({ org_id: B, user_id: null, role: "member", display_name: "Direct" });
  assert.ok(direct.error, "direct insert must be refused");

  // paying for more makes room: 1 extra location (+5 staff) and 1 pack = 2 locations, 15 staff
  await sub({ status: "active", extra_locations: 1, staff_packs: 1, current_period_end: new Date(Date.now() + 30 * DAY).toISOString() });
  assert.equal((await loc("Second")).error, null);
  for (let i = 0; i < 10; i++) assert.equal((await addMember(`More ${i}`)).error, null);
  const over = await addMember("Over");
  assert.match(over.error?.message ?? "", /plan includes 15 staff/i);
});

test("a paid plan's limits are visible to its team only", async () => {
  const s = (await ownerA.rpc("billing_status", { p_org: st.orgA.id })).data;
  assert.equal(s.max_locations, 4);
  assert.equal(s.max_staff, 4 * 5 + 2 * 5);
  const stranger = await signedIn(st.people.stranger.email, st.people.stranger.password);
  assert.equal((await stranger.rpc("billing_status", { p_org: st.orgA.id })).data, null, "outsiders learn nothing about a plan");
});

test("with no active plan nothing can be booked, added or changed; reading still works; paying restores it all", async () => {
  await sub({ status: "trial", trial_ends_at: new Date(Date.now() - DAY).toISOString() }); // trial ended yesterday
  assert.equal((await pub.rpc("org_accepts_bookings", { p_org: B })).data, false);
  assert.equal((await ownerB.rpc("billing_status", { p_org: B })).data.entitled, false);

  // every way of booking ends in the same insert, which the database refuses
  const members = (await admin.from("memberships").select("id").eq("org_id", B)).data;
  const start = new Date(Date.now() + 5 * DAY);
  const end = new Date(+start + 3600_000).toISOString();
  const insert = (client) => client.from("bookings").insert({ org_id: B, member_id: members[0].id, starts_at: start.toISOString(), ends_at: end, blocked_until: end, service_name: "X" });
  for (const [who, c] of [["owner", ownerB], ["service role", admin]]) {
    const r = await insert(c);
    assert.ok(r.error, `${who} insert must be refused`);
    assert.match(r.error.message, /not accepting bookings|row-level/i);
  }
  const viaPublic = await pub.rpc("create_public_booking", { p_org: B, p_service: st.orgB.services.physio, p_member: members[0].id, p_starts_at: start.toISOString(), p_name: "Pat", p_email: "pat@customers.tempo-e2e.test", p_phone: "", p_notes: "", p_location: null, p_address: "" });
  assert.ok(viaPublic.error, "public booking must be refused");

  // the dashboard is read-only: nothing new, nothing edited
  assert.ok((await ownerB.from("services").insert({ org_id: B, name: "New", slug: "new", duration_minutes: 30 })).error);
  const edit = await ownerB.from("services").update({ name: "Renamed" }).eq("org_id", B).select();
  assert.ok(edit.error || edit.data.length === 0, "edit must be refused");
  const org = await ownerB.from("organizations").update({ name: "Renamed" }).eq("id", B).select();
  assert.ok(org.error || org.data.length === 0, "settings are read-only");
  assert.ok((await ownerB.from("services").select("name").eq("org_id", B)).data.length >= 1, "reading works");
  assert.ok((await ownerB.from("locations").insert({ org_id: B, name: "No" })).error);

  // the public page says so, neutrally
  const page = await (await fetch(`${APP}/${st.orgB.slug}`)).text();
  assert.match(page, /accepting bookings right now/);
  assert.doesNotMatch(page, /subscription|payment/i);

  // paying turns everything back on at once
  await sub({ status: "active", current_period_end: new Date(Date.now() + 30 * DAY).toISOString() });
  assert.equal((await pub.rpc("org_accepts_bookings", { p_org: B })).data, true);
  assert.equal((await ownerB.from("services").update({ name: "Physio" }).eq("org_id", B).select()).data.length, 1);
  assert.doesNotMatch(await (await fetch(`${APP}/${st.orgB.slug}`)).text(), /accepting bookings right now/);
});

test("cancel at period end keeps access until the period ends (plus two days of slack for a late notice)", async () => {
  await sub({ status: "active", cancel_at_period_end: true, current_period_end: new Date(Date.now() + 5 * DAY).toISOString() });
  assert.equal((await ownerB.rpc("billing_status", { p_org: B })).data.entitled, true);
  await sub({ current_period_end: new Date(Date.now() - 3 * DAY).toISOString() });
  assert.equal((await ownerB.rpc("billing_status", { p_org: B })).data.entitled, false);
});

test("billing webhook: forged or unsigned requests change nothing", async () => {
  await sub({ stripe_customer_id: "cus_forge" });
  const s = await mockSub("cus_forge", items(2, 1));
  assert.equal((await send("customer.subscription.created", s, { badSig: true })).status, 400);
  assert.equal((await send("customer.subscription.created", s, { secret: "whsec_wrong" })).status, 400);
  const bare = await fetch(`${APP}/api/stripe/billing-webhook`, { method: "POST", body: "{}" });
  assert.equal(bare.status, 400);
  const r = await row();
  assert.equal(r.status, "trial");
  assert.equal(r.extra_locations, 0);
});

test("billing webhook: a subscription starts the plan, a replay changes nothing, an old event can't undo a new one", async () => {
  await sub({ stripe_customer_id: "cus_one" });
  const s = await mockSub("cus_one", items(2, 1));
  const first = await send("customer.subscription.created", s);
  assert.equal(first.status, 200, first.body);
  let r = await row();
  assert.equal(r.status, "active");
  assert.equal(r.extra_locations, 2);
  assert.equal(r.staff_packs, 1);
  assert.equal(r.stripe_subscription_id, s.id);
  assert.ok(r.current_period_end);
  assert.equal((await ownerB.rpc("billing_status", { p_org: B })).data.max_staff, 3 * 5 + 5); // 3 locations, 1 pack

  // "subscription started" email goes to the owner, once
  const started = (await mock.sent()).emails.filter((e) => /subscription is active/i.test(e.subject));
  assert.equal(started.length, 1);
  assert.ok([].concat(started[0].to).includes(st.people.ownerB.email));

  // the same event again (Stripe retries): acknowledged, nothing changes, no second email
  await sub({ extra_locations: 7 }); // if it were applied again this would be overwritten
  const replay = await send("customer.subscription.created", s, { id: first.event.id });
  assert.equal(replay.status, 200);
  assert.match(replay.body, /duplicate/);
  assert.equal((await row()).extra_locations, 7);
  assert.equal((await mock.sent()).emails.filter((e) => /subscription is active/i.test(e.subject)).length, 1);

  // a newer change, then an older event delivered late
  const now = Math.floor(Date.now() / 1000);
  const newer = await setStripe(s.id, { items: items(3, 0) });
  await send("customer.subscription.updated", newer, { created: now + 10 });
  r = await row();
  assert.equal(r.extra_locations, 3);
  assert.equal(r.staff_packs, 0);
  await send("customer.subscription.updated", { ...s }, { created: now - 500 });
  assert.equal((await row()).extra_locations, 3, "an older event must not undo a newer one");
  assert.equal((await mock.sent()).emails.filter((e) => /plan was updated/i.test(e.subject)).length, 1);
});

test("billing webhook: checkout.session.completed activates the plan from Stripe's own record", async () => {
  await sub({ stripe_customer_id: "cus_co" });
  const s = await mockSub("cus_co", items(1, 0));
  const session = { id: "cs_mock_x", object: "checkout.session", mode: "subscription", client_reference_id: B, subscription: s.id, customer: "cus_co" };
  const r = await send("checkout.session.completed", session);
  assert.equal(r.status, 200, r.body);
  const now = await row();
  assert.equal(now.status, "active");
  assert.equal(now.extra_locations, 1);
  // a subscription belonging to some other Stripe customer can't move this business
  const other = await mockSub("cus_other", items(9, 9));
  await send("checkout.session.completed", { ...session, subscription: other.id, customer: "cus_other" });
  assert.equal((await row()).extra_locations, 1);
});

test("failed payment: owner is emailed, 7 days of grace, then expired; paying fixes it", async () => {
  await sub({ stripe_customer_id: "cus_pf" });
  const s = await mockSub("cus_pf", items(0, 0));
  await send("customer.subscription.created", s);
  await mock.clear();
  await setStripe(s.id, { status: "past_due" }); // Stripe moves the subscription to past_due after a failed renewal
  const failed = await send("invoice.payment_failed", invoice("in_1", "cus_pf", s.id));
  assert.equal(failed.status, 200, failed.body);
  let r = await row();
  assert.equal(r.status, "past_due");
  assert.ok(r.past_due_since);
  const mails = (await mock.sent()).emails.filter((e) => /couldn.t take your tempo payment/i.test(e.subject));
  assert.equal(mails.length, 1);
  assert.ok([].concat(mails[0].to).includes(st.people.ownerB.email));
  // still working during the grace period
  assert.equal((await ownerB.rpc("billing_status", { p_org: B })).data.entitled, true);
  // a second failure (Stripe's retry) doesn't restart the clock
  const since = r.past_due_since;
  await send("invoice.payment_failed", invoice("in_2", "cus_pf", s.id), { created: Math.floor(Date.now() / 1000) + 5 });
  assert.equal((await row()).past_due_since, since);

  // 8 days later, nothing fixed: no longer entitled (immediately, by the clock), and the hourly job records it
  await sub({ past_due_since: new Date(Date.now() - 8 * DAY).toISOString() });
  assert.equal((await ownerB.rpc("billing_status", { p_org: B })).data.entitled, false);
  assert.equal((await pub.rpc("org_accepts_bookings", { p_org: B })).data, false);
  await cron();
  assert.equal((await row()).status, "expired");

  // card fixed: Stripe says paid and the subscription is active again
  await sub({ status: "past_due", past_due_since: new Date(Date.now() - 2 * DAY).toISOString() });
  await setStripe(s.id, { status: "active" });
  await send("invoice.paid", invoice("in_3", "cus_pf", s.id), { created: Math.floor(Date.now() / 1000) + 20 });
  r = await row();
  assert.equal(r.status, "active");
  assert.equal(r.past_due_since, null);
});

test("subscription deleted: the plan ends", async () => {
  await sub({ stripe_customer_id: "cus_del" });
  const s = await mockSub("cus_del", items(0, 0));
  await send("customer.subscription.created", s);
  await setStripe(s.id, { status: "canceled" });
  const gone = await send("customer.subscription.deleted", { ...s, status: "canceled" }, { created: Math.floor(Date.now() / 1000) + 5 });
  assert.equal(gone.status, 200, gone.body);
  assert.equal((await row()).status, "cancelled");
  assert.equal((await pub.rpc("org_accepts_bookings", { p_org: B })).data, false);
});

test("the hourly job emails the owner 3 days before the trial ends, and once the trial has ended; never twice", async () => {
  const mails = async (re) => (await mock.sent()).emails.filter((e) => re.test(e.subject) && [].concat(e.to).includes(st.people.ownerB.email));

  await sub({ trial_ends_at: new Date(Date.now() + 10 * DAY).toISOString() });
  await cron();
  assert.equal((await mails(/trial ends/i)).length, 0, "too early to remind");

  await sub({ trial_ends_at: new Date(Date.now() + 2 * DAY).toISOString() });
  await cron();
  await cron();
  assert.equal((await mails(/trial ends in/i)).length, 1, "one reminder only");

  await sub({ trial_ends_at: new Date(Date.now() - 3600_000).toISOString() });
  await cron();
  await cron();
  assert.equal((await mails(/trial has ended/i)).length, 1, "one trial-ended notice only");
  assert.equal((await row()).status, "expired");
});
