/**
 * Drives the real billing webhook route (src/app/api/stripe/billing-webhook/route.ts) against an in-memory stand-in for
 * Supabase's REST API on 127.0.0.1. No network, nothing remote, no real Stripe: events are signed locally with a test
 * secret. Run (not part of `npm test`, because `server-only` needs the react-server condition):
 *
 *   npx tsx --conditions react-server --test tests/webhook/billing-webhook.test.ts
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Stripe from "stripe";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let failNextSubscriptionPatch = false;
const log: string[] = [];

function matches(row: Row, params: URLSearchParams) {
  for (const [k, v] of params) {
    if (["select", "limit", "order", "offset", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    const cell = row[k];
    if (op === "eq" && String(cell) !== val) return false;
    if (op === "is" && val === "null" && cell !== null && cell !== undefined) return false;
    if (op === "lt" && !(String(cell) < val)) return false;
    if (op === "lte" && !(String(cell) <= val)) return false;
    if (op === "gt" && !(String(cell) > val)) return false;
    if (op === "not" && val === "is.null" && (cell === null || cell === undefined)) return false;
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
      if (!list.includes(String(cell))) return false;
    }
  }
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  const table = url.pathname.replace("/rest/v1/", "");
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const rows = (db[table] ??= []);
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
    const wantObject = String(req.headers.accept ?? "").includes("pgrst.object");
    const wantRows = String(req.headers.prefer ?? "").includes("return=representation");
    if (req.method === "GET" || req.method === "HEAD") {
      const found = rows.filter((r) => matches(r, url.searchParams));
      if (wantObject) return found.length === 1 ? send(200, found[0]) : send(406, { code: "PGRST116", message: "no rows", details: "", hint: "" });
      return send(200, found);
    }
    if (req.method === "POST") {
      const body = JSON.parse(raw);
      if (table === "stripe_billing_events" && rows.some((r) => r.id === body.id)) return send(409, { code: "23505", message: "duplicate key" });
      if (table === "stripe_billing_events") body.received_at ??= new Date().toISOString(); // the column default
      rows.push(body);
      log.push(`insert ${table} ${body.id ?? ""}`);
      return send(201, wantRows ? [body] : undefined);
    }
    if (req.method === "PATCH") {
      if (table === "subscriptions" && failNextSubscriptionPatch) { failNextSubscriptionPatch = false; return send(500, { code: "XX000", message: "boom" }); }
      const body = JSON.parse(raw);
      const found = rows.filter((r) => matches(r, url.searchParams));
      for (const r of found) Object.assign(r, body);
      log.push(`update ${table} ${JSON.stringify(body).slice(0, 80)}`);
      return send(200, wantRows ? found : undefined);
    }
    if (req.method === "DELETE") {
      const found = rows.filter((r) => matches(r, url.searchParams));
      db[table] = rows.filter((r) => !found.includes(r));
      log.push(`delete ${table} ${found.length}`);
      return send(200, wantRows ? found : undefined);
    }
    send(405, {});
  });
});

// A stand-in for the Stripe API (the SDK is pointed at it with STRIPE_MOCK_URL). Subscriptions live in stripeSubs.
const stripeSubs: Record<string, Record<string, unknown>> = {};
const stripeCalls: string[] = [];
let stripeFailFor: string | null = null;
const stripeServer = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  req.resume();
  req.on("end", () => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    stripeCalls.push(`${req.method} ${url.pathname}`);
    const m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (m) {
      if (stripeFailFor === m[1]) return send(500, { error: { type: "api_error", message: "boom" } });
      const sub = stripeSubs[m[1]];
      if (!sub) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such subscription" } });
      if (req.method === "DELETE") { sub.status = "canceled"; }
      return send(200, sub);
    }
    if (url.pathname === "/v1/subscriptions") {
      const cust = url.searchParams.get("customer");
      return send(200, { object: "list", has_more: false, url: "/v1/subscriptions", data: Object.values(stripeSubs).filter((x) => x.customer === cust) });
    }
    send(404, { error: { type: "invalid_request_error", message: "unmocked " + url.pathname } });
  });
});

const SECRET = "whsec_test_billing_secret";
const PRICES = { base: "price_base", location: "price_loc", pack: "price_pack" };
const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
let route: typeof import("../../src/app/api/stripe/billing-webhook/route");
let stripe: Stripe;
let seq = 0;

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => stripeServer.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    TEMPO_E2E: "1",
    STRIPE_MOCK_URL: `http://127.0.0.1:${(stripeServer.address() as { port: number }).port}`,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_BILLING_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_BASE: PRICES.base,
    STRIPE_PRICE_EXTRA_LOCATION: PRICES.location,
    STRIPE_PRICE_STAFF_PACK: PRICES.pack,
  });
  delete process.env.RESEND_API_KEY;
  stripe = new Stripe("sk_test_dummy");
  route = await import("../../src/app/api/stripe/billing-webhook/route");
});
after(() => { server.close(); stripeServer.close(); });

const trialRow = (): Row => ({
  org_id: ORG, status: "trial", trial_ends_at: new Date(Date.now() + 10 * 86400_000).toISOString(), current_period_end: null,
  extra_locations: 0, staff_packs: 0, stripe_customer_id: null, stripe_subscription_id: null, cancel_at_period_end: false,
  past_due_since: null, last_stripe_event_at: null,
});
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.subscriptions = [trialRow(), { ...trialRow(), org_id: OTHER_ORG, stripe_customer_id: "cus_other" }];
  db.organizations = []; db.memberships = []; db.profiles = [];
  log.length = 0;
  failNextSubscriptionPatch = false;
  for (const k of Object.keys(stripeSubs)) delete stripeSubs[k];
  stripeCalls.length = 0;
  stripeFailFor = null;
});
const sub = () => db.subscriptions.find((r) => r.org_id === ORG)!;

function subscriptionObject(o: { id?: string; customer?: string; status?: string; locs?: number; packs?: number; cancel?: boolean; org?: string; periodEnd?: number }) {
  const items = [{ price: { id: PRICES.base }, quantity: 1, current_period_end: o.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400 }];
  if (o.locs) items.push({ price: { id: PRICES.location }, quantity: o.locs, current_period_end: items[0].current_period_end });
  if (o.packs) items.push({ price: { id: PRICES.pack }, quantity: o.packs, current_period_end: items[0].current_period_end });
  return { id: o.id ?? "sub_1", object: "subscription", customer: o.customer ?? "cus_1", status: o.status ?? "active", cancel_at_period_end: Boolean(o.cancel), metadata: { org_id: o.org ?? ORG }, items: { object: "list", data: items } };
}

async function deliver(type: string, object: unknown, opts: { id?: string; created?: number; secret?: string; tamper?: boolean; extra?: Record<string, unknown>; stripeState?: boolean } = {}) {
  // By default Stripe's own copy of the subscription is the one in the event; tests that want them to differ pass stripeState: false.
  const o = object as { object?: string; id?: string };
  if (opts.stripeState !== false && o.object === "subscription" && o.id) stripeSubs[o.id] = object as Record<string, unknown>;
  const event = { id: opts.id ?? `evt_${++seq}`, object: "event", type, created: opts.created ?? Math.floor(Date.now() / 1000), data: { object }, ...opts.extra };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET });
  const res = await route.POST(new Request("http://localhost/api/stripe/billing-webhook", { method: "POST", headers: { "stripe-signature": header }, body: opts.tamper ? payload.replace("sub_1", "sub_9") : payload }));
  return { status: res.status, body: await res.text(), event };
}

test("forged or missing signature: 400 and nothing is written", async () => {
  const obj = subscriptionObject({});
  assert.equal((await deliver("customer.subscription.created", obj, { secret: "whsec_wrong" })).status, 400);
  assert.equal((await deliver("customer.subscription.created", obj, { tamper: true })).status, 400);
  const none = await route.POST(new Request("http://localhost/x", { method: "POST", body: "{}" }));
  assert.equal(none.status, 400);
  assert.equal(sub().status, "trial");
  assert.equal((db.stripe_billing_events ?? []).length, 0);
});

test("a signed subscription event makes the business active with the plan read from Stripe (3 locations + 2 packs)", async () => {
  const r = await deliver("customer.subscription.created", subscriptionObject({ locs: 2, packs: 2 }));
  assert.equal(r.status, 200);
  assert.equal(sub().status, "active");
  assert.equal(sub().extra_locations, 2);
  assert.equal(sub().staff_packs, 2);
  assert.equal(sub().stripe_customer_id, "cus_1");
});

test("replayed event id: acknowledged, state not touched", async () => {
  const obj = subscriptionObject({ packs: 1 });
  const first = await deliver("customer.subscription.updated", obj, { id: "evt_same" });
  assert.equal(first.status, 200);
  sub().staff_packs = 7; // something changed since
  const again = await deliver("customer.subscription.updated", obj, { id: "evt_same" });
  assert.equal(again.status, 200);
  assert.match(again.body, /duplicate/);
  assert.equal(sub().staff_packs, 7);
});

test("out of order: an older event delivered late does not undo a newer one", async () => {
  const t = Math.floor(Date.now() / 1000);
  await deliver("customer.subscription.updated", subscriptionObject({ packs: 3 }), { created: t });
  assert.equal(sub().staff_packs, 3);
  await deliver("customer.subscription.updated", subscriptionObject({ packs: 0 }), { created: t - 500 });
  assert.equal(sub().staff_packs, 3);
  await deliver("customer.subscription.deleted", subscriptionObject({ status: "canceled" }), { created: t - 400 });
  assert.equal(sub().status, "active");
});

test("failed payment starts the 7-day grace once; later failures don't restart it; payment fixes it", async () => {
  const t = Math.floor(Date.now() / 1000);
  await deliver("customer.subscription.created", subscriptionObject({}), { created: t - 100 });
  const inv = { id: "in_1", object: "invoice", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } };
  stripeSubs.sub_1.status = "past_due"; // Stripe moves the subscription to past_due after a failed renewal
  await deliver("invoice.payment_failed", inv, { created: t - 50 });
  assert.equal(sub().status, "past_due");
  const since = sub().past_due_since as string;
  assert.ok(since);
  await new Promise((r) => setTimeout(r, 20));
  await deliver("invoice.payment_failed", inv, { created: t - 40 });
  assert.equal(sub().past_due_since, since, "grace period start must not move on a retry");
  stripeSubs.sub_1.status = "active";
  await deliver("invoice.paid", inv, { created: t - 30 });
  assert.equal(sub().status, "active");
  assert.equal(sub().past_due_since, null);
});

test("Stripe past_due status event also starts the grace period from now, and keeps the first date", async () => {
  const t = Math.floor(Date.now() / 1000);
  await deliver("customer.subscription.updated", subscriptionObject({ status: "past_due" }), { created: t - 20 });
  const since = sub().past_due_since;
  assert.ok(since);
  await deliver("customer.subscription.updated", subscriptionObject({ status: "past_due" }), { created: t - 10 });
  assert.equal(sub().past_due_since, since);
});

test("cancel at period end: stays active with the flag and period end; deleted event makes it cancelled", async () => {
  const end = Math.floor(Date.now() / 1000) + 12 * 86400;
  const t = Math.floor(Date.now() / 1000);
  await deliver("customer.subscription.updated", subscriptionObject({ cancel: true, periodEnd: end }), { created: t - 20 });
  assert.equal(sub().status, "active");
  assert.equal(sub().cancel_at_period_end, true);
  assert.equal(new Date(sub().current_period_end as string).getTime(), end * 1000);
  await deliver("customer.subscription.deleted", subscriptionObject({ status: "canceled", cancel: true, periodEnd: end }), { created: t - 10 });
  assert.equal(sub().status, "cancelled");
  assert.equal(sub().cancel_at_period_end, false);
});

test("an incomplete first payment does not make a trial business active", async () => {
  await deliver("customer.subscription.created", subscriptionObject({ status: "incomplete" }));
  assert.equal(sub().status, "trial");
});

test("metadata can't hijack another business: a customer id stored for someone else wins", async () => {
  // the event names ORG in its metadata, but cus_other is stored on OTHER_ORG
  await deliver("customer.subscription.created", subscriptionObject({ customer: "cus_other", org: ORG, packs: 5 }));
  assert.equal(sub().status, "trial", "ORG must not be changed");
  assert.equal(db.subscriptions.find((r) => r.org_id === OTHER_ORG)!.status, "active");
});

test("an unknown business is acknowledged and changes nothing", async () => {
  const r = await deliver("customer.subscription.created", subscriptionObject({ customer: "cus_nobody", org: "33333333-3333-3333-3333-333333333333" }));
  assert.equal(r.status, 200);
  assert.equal(sub().status, "trial");
});

test("D-004: a second paid subscription for a business that is already paying is CANCELLED in Stripe and ignored locally", async () => {
  await deliver("customer.subscription.created", subscriptionObject({ id: "sub_1", packs: 1 }));
  await deliver("customer.subscription.created", subscriptionObject({ id: "sub_2", packs: 9 }));
  assert.equal(sub().stripe_subscription_id, "sub_1");
  assert.equal(sub().staff_packs, 1);
  assert.ok(stripeCalls.includes("DELETE /v1/subscriptions/sub_2"), "the duplicate is cancelled at Stripe");
  assert.ok(!stripeCalls.includes("DELETE /v1/subscriptions/sub_1"), "the original is untouched");
  assert.equal(stripeSubs.sub_2.status, "canceled");
});

test("D-004: if the subscription we have is already dead in Stripe, the new one takes over instead of being cancelled", async () => {
  await deliver("customer.subscription.created", subscriptionObject({ id: "sub_1", packs: 1 }));
  stripeSubs.sub_1.status = "canceled"; // our copy was behind
  await deliver("customer.subscription.created", subscriptionObject({ id: "sub_2", packs: 2 }));
  assert.equal(sub().stripe_subscription_id, "sub_2");
  assert.equal(sub().staff_packs, 2);
  assert.ok(!stripeCalls.some((c) => c.startsWith("DELETE")));
});

test("D-004: an old subscription ending after the replacement is live changes nothing and cancels nothing", async () => {
  await deliver("customer.subscription.created", subscriptionObject({ id: "sub_1", packs: 1 }));
  await deliver("customer.subscription.deleted", subscriptionObject({ id: "sub_old", status: "canceled", packs: 5, customer: "cus_1" }));
  assert.equal(sub().stripe_subscription_id, "sub_1");
  assert.ok(!stripeCalls.some((c) => c.startsWith("DELETE")));
});

test("S-003: an event from a connected account (event.account) is refused: nothing is read or written", async () => {
  const r = await deliver("customer.subscription.created", subscriptionObject({ packs: 4 }), { extra: { account: "acct_tenant" } });
  assert.equal(r.status, 200);
  assert.equal(sub().status, "trial");
  assert.equal((db.stripe_billing_events ?? []).length, 0);
  assert.equal(stripeCalls.length, 0);
});

test("S-003: an event from the other mode (livemode true against a test key) is refused", async () => {
  await deliver("customer.subscription.created", subscriptionObject({ packs: 4 }), { extra: { livemode: true } });
  assert.equal(sub().status, "trial");
});

test("S-003: the event payload is not trusted: what is applied is Stripe's own copy of the subscription", async () => {
  stripeSubs.sub_1 = subscriptionObject({ id: "sub_1", packs: 1, status: "active" });
  // the (signed) payload claims 9 packs; Stripe says 1
  await deliver("customer.subscription.updated", subscriptionObject({ id: "sub_1", packs: 9 }), { stripeState: false });
  assert.equal(sub().staff_packs, 1);
  // a payload for a subscription Stripe doesn't know is ignored
  await deliver("customer.subscription.created", subscriptionObject({ id: "sub_ghost", packs: 9, customer: "cus_x" }), { stripeState: false });
  assert.equal(sub().stripe_subscription_id, "sub_1");
});

test("S-008: two concurrent deliveries of one event id: one is processed, the other is a duplicate or told to retry (409)", async () => {
  const obj = subscriptionObject({ packs: 1 });
  stripeSubs.sub_1 = obj;
  const mk = () => deliver("customer.subscription.updated", obj, { id: "evt_race" });
  const [a, b] = await Promise.all([mk(), mk()]);
  const codes = [a.status, b.status].sort();
  assert.ok(codes.includes(200), "one is processed");
  assert.ok(codes[1] === 200 || codes[1] === 409, "the other is a duplicate (200) or told to retry (409): " + codes.join());
  assert.equal(log.filter((l) => l.startsWith("update subscriptions")).length, 1, "the subscription is written once");
  // a stale claim (a crashed run) can be taken over by the retry
  db.stripe_billing_events.push({ id: "evt_stale", type: "x", received_at: new Date(Date.now() - 3600_000).toISOString(), processed_at: null });
  const r = await deliver("customer.subscription.updated", obj, { id: "evt_stale" });
  assert.equal(r.status, 200);
  assert.ok(db.stripe_billing_events.find((e) => e.id === "evt_stale")!.processed_at);
  // a fresh in-flight claim is not taken over
  db.stripe_billing_events.push({ id: "evt_busy", type: "x", received_at: new Date().toISOString(), processed_at: null });
  assert.equal((await deliver("customer.subscription.updated", obj, { id: "evt_busy" })).status, 409);
});

test("S-008: an invoice without a subscription (a one-off invoice) does not start a grace period", async () => {
  await deliver("customer.subscription.created", subscriptionObject({}));
  const before = JSON.stringify(sub());
  await deliver("invoice.payment_failed", { id: "in_x", object: "invoice", customer: "cus_1" });
  assert.equal(JSON.stringify(sub()), before);
  assert.equal(sub().status, "active");
});

test("D-012: a payment problem is announced once (when it starts), not on every retry; a new problem is announced again", async () => {
  const { applyStripeSubscription } = await import("../../src/lib/billing-server");
  const base = subscriptionObject({});
  await deliver("customer.subscription.created", base);
  const pastDue = subscriptionObject({ status: "past_due" }) as unknown as Stripe.Subscription;
  const first = await applyStripeSubscription(pastDue, {});
  const retry = await applyStripeSubscription(pastDue, {});
  assert.equal(first?.paymentFailed, true);
  assert.equal(retry?.paymentFailed, false);
  await applyStripeSubscription(base as unknown as Stripe.Subscription, {}); // paid
  assert.equal((await applyStripeSubscription(pastDue, {}))?.paymentFailed, true, "a new problem is announced again");
});

test("S-008: direct applies (after Checkout, plan change, cancel) stamp last_stripe_event_at so an older snapshot can't overwrite them", async () => {
  const { applyStripeSubscription } = await import("../../src/lib/billing-server");
  const now = Math.floor(Date.now() / 1000);
  await applyStripeSubscription(subscriptionObject({ packs: 3 }) as unknown as Stripe.Subscription, { orgHint: ORG, eventAt: now });
  assert.ok(sub().last_stripe_event_at);
  const stale = await applyStripeSubscription(subscriptionObject({ packs: 0 }) as unknown as Stripe.Subscription, { eventAt: now - 100 });
  assert.equal(stale, null);
  assert.equal(sub().staff_packs, 3);
  // same second: applied (the subscription was just re-read from Stripe, so it is current)
  await applyStripeSubscription(subscriptionObject({ packs: 4 }) as unknown as Stripe.Subscription, { eventAt: now });
  assert.equal(sub().staff_packs, 4);
});

test("S-007: the hourly sweep re-reads paying businesses from Stripe (a lost webhook is repaired) and tolerates errors", async () => {
  const { runBillingSweep } = await import("../../src/lib/billing-server");
  const A = "c1000000-0000-0000-0000-000000000001", B = "c2000000-0000-0000-0000-000000000002", C = "c3000000-0000-0000-0000-000000000003";
  const mk = (org: string, subId: string, cust: string) => ({ ...trialRow(), org_id: org, status: "active", stripe_customer_id: cust, stripe_subscription_id: subId, current_period_end: new Date(Date.now() + 5 * 86400_000).toISOString() });
  db.subscriptions = [mk(A, "sub_a", "cus_a"), mk(B, "sub_b", "cus_b"), mk(C, "sub_c", "cus_c")];
  stripeSubs.sub_a = subscriptionObject({ id: "sub_a", customer: "cus_a", status: "canceled", org: A });
  stripeSubs.sub_b = subscriptionObject({ id: "sub_b", customer: "cus_b", org: B });
  stripeFailFor = "sub_b"; // Stripe errors for this one
  stripeSubs.sub_c = subscriptionObject({ id: "sub_c", customer: "cus_c", packs: 2, org: C });
  const r = await runBillingSweep(new Date());
  const st = (n: string) => db.subscriptions.find((x) => x.org_id === n)!;
  assert.equal(st(A).status, "cancelled", "lost 'deleted' event repaired");
  assert.equal(st(B).status, "active", "an error for one subscription is tolerated");
  assert.equal(st(C).staff_packs, 2, "missed plan change repaired; the sweep carried on after the error");
  assert.equal(r.reconciled, 2);
});

test("S-008: stripe_billing_events older than 90 days are purged by the sweep; recent ones stay", async () => {
  const { runBillingSweep } = await import("../../src/lib/billing-server");
  db.stripe_billing_events = [
    { id: "evt_old", type: "x", received_at: new Date(Date.now() - 100 * 86400_000).toISOString(), processed_at: null },
    { id: "evt_new", type: "x", received_at: new Date(Date.now() - 10 * 86400_000).toISOString(), processed_at: null },
  ];
  const r = await runBillingSweep(new Date());
  assert.deepEqual(db.stripe_billing_events.map((e) => e.id), ["evt_new"]);
  assert.equal(r.purged, 1);
});

test("processing failure: 500, event stays unprocessed, and Stripe's retry (same id) is processed", async () => {
  failNextSubscriptionPatch = true;
  const obj = subscriptionObject({ packs: 2 });
  const r1 = await deliver("customer.subscription.updated", obj, { id: "evt_retry" });
  assert.equal(r1.status, 500);
  assert.equal(sub().status, "trial");
  const ev = db.stripe_billing_events.find((e) => e.id === "evt_retry")!;
  assert.ok(ev && !ev.processed_at);
  const r2 = await deliver("customer.subscription.updated", obj, { id: "evt_retry" });
  assert.equal(r2.status, 200);
  assert.equal(sub().staff_packs, 2);
  assert.ok(db.stripe_billing_events.find((e) => e.id === "evt_retry")!.processed_at);
});

test("unrelated event types are acknowledged", async () => {
  const r = await deliver("customer.created", { id: "cus_x" });
  assert.equal(r.status, 200);
});

test("hourly sweep: trial end, 7-day grace and cancel-at-period-end boundaries", async () => {
  const { runBillingSweep } = await import("../../src/lib/billing-server");
  const now = new Date();
  const mk = (org: string, over: Row) => ({ ...trialRow(), org_id: org, ...over });
  const d = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const H = 3600_000, D = 86400_000;
  db.subscriptions = [
    mk("a0000000-0000-0000-0000-000000000001", { trial_ends_at: d(-1000) }),
    mk("a0000000-0000-0000-0000-000000000002", { trial_ends_at: d(+1000) }),
    mk("a0000000-0000-0000-0000-000000000003", { status: "past_due", past_due_since: d(-7 * D - 60_000) }),
    mk("a0000000-0000-0000-0000-000000000004", { status: "past_due", past_due_since: d(-7 * D + H) }),
    mk("a0000000-0000-0000-0000-000000000005", { status: "active", cancel_at_period_end: true, current_period_end: d(-2 * D - 60_000) }),
    mk("a0000000-0000-0000-0000-000000000006", { status: "active", cancel_at_period_end: true, current_period_end: d(-1 * D) }),
    mk("a0000000-0000-0000-0000-000000000007", { status: "active", cancel_at_period_end: false, current_period_end: d(-30 * D) }),
  ];
  const st = (n: number) => db.subscriptions.find((r) => r.org_id === `a0000000-0000-0000-0000-00000000000${n}`)!.status;
  await runBillingSweep(now);
  assert.equal(st(1), "expired", "trial 1s past its end");
  assert.equal(st(2), "trial", "trial 1s before its end");
  assert.equal(st(3), "expired", "past due 7 days + 1 min");
  assert.equal(st(4), "past_due", "past due 6 days 23 hours");
  assert.equal(st(5), "cancelled", "cancelled plan, 2 days + 1 min after period end");
  assert.equal(st(6), "active", "cancelled plan, 1 day after period end (slack)");
  assert.equal(st(7), "active", "not cancelled: renewal is Stripe's job, status untouched");
});

test("hourly sweep scoped to some businesses leaves the others alone", async () => {
  const { runBillingSweep } = await import("../../src/lib/billing-server");
  db.subscriptions = [
    { ...trialRow(), org_id: "b0000000-0000-0000-0000-000000000001", trial_ends_at: new Date(Date.now() - 1000).toISOString() },
    { ...trialRow(), org_id: "b0000000-0000-0000-0000-000000000002", trial_ends_at: new Date(Date.now() - 1000).toISOString() },
  ];
  await runBillingSweep(new Date(), ["b0000000-0000-0000-0000-000000000001"]);
  assert.equal(db.subscriptions[0].status, "expired");
  assert.equal(db.subscriptions[1].status, "trial");
});
