/**
 * Round-2 QA checks for billing (Checkout guard against a second subscription, email counts, races). Same approach as
 * billing-webhook.test.ts: in-memory stand-ins for Supabase REST, Stripe and Resend on 127.0.0.1; nothing remote.
 *
 *   npx tsx --conditions react-server --test tests/webhook/billing-retest.test.ts
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Stripe from "stripe";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const emails: { subject: string; to: unknown }[] = [];
// Test hooks for the REST stand-in: fail reads of the subscriptions table (D-017), and run something just before the next
// subscriptions write, to simulate another writer getting in between a read and a write (S-014).
let failSubsRead: ((url: string) => boolean) | null = null;
let beforeSubsWrite: (() => void) | null = null;
const subsReads: string[] = [];

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
const rest = http.createServer((req, res) => {
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
      if (table === "subscriptions") {
        subsReads.push(decodeURIComponent(url.search));
        if (failSubsRead?.(decodeURIComponent(url.search))) return send(500, { code: "XX000", message: "boom", details: "", hint: "" });
      }
      let found = rows.filter((r) => matches(r, url.searchParams));
      // order=col.asc.nullsfirst (what the sweep asks for) and limit=N, like PostgREST
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir, nulls] = order.split(".");
        const sign = dir === "desc" ? -1 : 1;
        found = [...found].sort((a, b) => {
          const x = a[col] ?? null, y = b[col] ?? null;
          if (x === null || y === null) return x === y ? 0 : ((x === null) === (nulls !== "nullslast") ? -1 : 1);
          return String(x) < String(y) ? -sign : String(x) > String(y) ? sign : 0;
        });
      }
      const lim = url.searchParams.get("limit");
      if (lim) found = found.slice(0, Number(lim));
      if (wantObject) return found.length === 1 ? send(200, found[0]) : send(406, { code: "PGRST116", message: "no rows", details: "", hint: "" });
      return send(200, found);
    }
    if (req.method === "POST") {
      const body = JSON.parse(raw);
      if (table === "stripe_billing_events" && rows.some((r) => r.id === body.id)) return send(409, { code: "23505", message: "duplicate key" });
      if (table === "stripe_billing_events") body.received_at ??= new Date().toISOString();
      rows.push(body);
      return send(201, wantRows ? [body] : undefined);
    }
    if (req.method === "PATCH") {
      if (table === "subscriptions" && beforeSubsWrite) { const f = beforeSubsWrite; beforeSubsWrite = null; f(); }
      const found = rows.filter((r) => matches(r, url.searchParams));
      for (const r of found) Object.assign(r, JSON.parse(raw));
      return send(200, wantRows ? found : undefined);
    }
    if (req.method === "DELETE") {
      const found = rows.filter((r) => matches(r, url.searchParams));
      db[table] = rows.filter((r) => !found.includes(r));
      return send(200, wantRows ? found : undefined);
    }
    send(405, {});
  });
});

// Resend stand-in (the SDK honours RESEND_BASE_URL)
const resend = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const b = JSON.parse(raw || "{}");
    emails.push({ subject: b.subject, to: b.to });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "em_" + emails.length }));
  });
});

// Stripe stand-in
const stripeSubs: Record<string, Record<string, unknown>> = {};
const stripeCalls: { m: string; path: string; body: URLSearchParams; idem: string | null }[] = [];
const idemSessions: Record<string, unknown> = {};
// S-016: paid invoices of a subscription, their payments, and refunds (idempotent by Idempotency-Key, like Stripe)
const invoicesBySub: Record<string, Record<string, unknown>[]> = {};
const paymentsByInvoice: Record<string, Record<string, unknown>[]> = {};
const refundsByKey: Record<string, Record<string, unknown>> = {};
let refundsMade = 0;
let refundFails = false;
let stripeErrorFor: string | null = null; // a Stripe-side failure (500) for this subscription id
const stripeApi = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = new URLSearchParams(raw);
    const idem = (req.headers["idempotency-key"] as string) ?? null;
    stripeCalls.push({ m: req.method!, path: url.pathname, body, idem });
    const m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (m) {
      if (stripeErrorFor === m[1]) return send(500, { error: { type: "api_error", message: "boom" } });
      const sub = stripeSubs[m[1]];
      if (!sub) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such subscription" } });
      if (req.method === "DELETE") sub.status = "canceled";
      return send(200, sub);
    }
    if (url.pathname === "/v1/subscriptions") {
      const cust = url.searchParams.get("customer");
      return send(200, { object: "list", has_more: false, url: "/v1/subscriptions", data: Object.values(stripeSubs).filter((x) => x.customer === cust) });
    }
    const list = (data: unknown[]) => send(200, { object: "list", has_more: false, url: url.pathname, data });
    if (url.pathname === "/v1/invoices" && req.method === "GET") return list(invoicesBySub[url.searchParams.get("subscription") ?? ""] ?? []);
    if (url.pathname === "/v1/invoice_payments" && req.method === "GET") return list(paymentsByInvoice[url.searchParams.get("invoice") ?? ""] ?? []);
    if (url.pathname === "/v1/refunds" && req.method === "POST") {
      if (refundFails) return send(500, { error: { type: "api_error", message: "boom" } });
      if (idem && refundsByKey[idem]) return send(200, refundsByKey[idem]); // the same key returns the same refund: never a second one
      const r = { id: "re_" + ++refundsMade, object: "refund", amount: Number(body.get("amount") ?? 1500), currency: "cad", payment_intent: body.get("payment_intent"), charge: body.get("charge") };
      if (idem) refundsByKey[idem] = r;
      return send(200, r);
    }
    if (url.pathname === "/v1/billing_portal/sessions" && req.method === "POST") return send(200, { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.test/p/session" });
    if (url.pathname === "/v1/customers" && req.method === "POST") return send(200, { id: "cus_made", object: "customer" });
    if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
      if (idem && idemSessions[idem]) return send(200, idemSessions[idem]);
      const s = { id: "cs_test_" + (Object.keys(idemSessions).length + 1), object: "checkout.session", url: "https://checkout.stripe.test/c/pay/" + (Object.keys(idemSessions).length + 1) };
      if (idem) idemSessions[idem] = s;
      return send(200, s);
    }
    send(404, { error: { type: "invalid_request_error", message: "unmocked " + url.pathname } });
  });
});

const SECRET = "whsec_test_billing_secret";
const PRICES = { base: "price_base", location: "price_loc", pack: "price_pack" };
const ORG = "11111111-1111-1111-1111-111111111111";
let route: typeof import("../../src/app/api/stripe/billing-webhook/route");
let server: typeof import("../../src/lib/billing-server");
let stripe: Stripe;
let seq = 0;

before(async () => {
  await new Promise<void>((r) => rest.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => stripeApi.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => resend.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    TEMPO_E2E: "1",
    STRIPE_MOCK_URL: `http://127.0.0.1:${(stripeApi.address() as { port: number }).port}`,
    RESEND_BASE_URL: `http://127.0.0.1:${(resend.address() as { port: number }).port}`,
    RESEND_API_KEY: "re_test_local",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${(rest.address() as { port: number }).port}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_BILLING_WEBHOOK_SECRET: SECRET,
    STRIPE_PORTAL_CONFIGURATION: "bpc_test_tempo",
    STRIPE_PRICE_BASE: PRICES.base,
    STRIPE_PRICE_EXTRA_LOCATION: PRICES.location,
    STRIPE_PRICE_STAFF_PACK: PRICES.pack,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    BILLING_ALERT_EMAIL: "ops@example.test",
  });
  stripe = new Stripe("sk_test_dummy");
  route = await import("../../src/app/api/stripe/billing-webhook/route");
  server = await import("../../src/lib/billing-server");
});
after(() => { rest.close(); stripeApi.close(); resend.close(); });

const trialRow = (): Row => ({
  org_id: ORG, status: "trial", trial_ends_at: new Date(Date.now() + 10 * 86400_000).toISOString(), current_period_end: null,
  extra_locations: 0, staff_packs: 0, stripe_customer_id: null, stripe_subscription_id: null, cancel_at_period_end: false,
  past_due_since: null, last_stripe_event_at: null,
});
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.subscriptions = [trialRow()];
  db.organizations = [{ id: ORG, name: "Test Biz", slug: "test-biz", timezone: "America/Vancouver" }];
  db.memberships = [{ org_id: ORG, user_id: "u1", role: "owner" }];
  db.profiles = [{ id: "u1", email: "owner@example.test" }];
  emails.length = 0;
  stripeCalls.length = 0;
  for (const k of Object.keys(stripeSubs)) delete stripeSubs[k];
  for (const k of Object.keys(idemSessions)) delete idemSessions[k];
  for (const k of Object.keys(invoicesBySub)) delete invoicesBySub[k];
  for (const k of Object.keys(paymentsByInvoice)) delete paymentsByInvoice[k];
  for (const k of Object.keys(refundsByKey)) delete refundsByKey[k];
  refundsMade = 0; refundFails = false; stripeErrorFor = null; failSubsRead = null; beforeSubsWrite = null; subsReads.length = 0;
});
const sub = () => db.subscriptions.find((r) => r.org_id === ORG)!;
const org = { id: ORG, name: "Test Biz", slug: "test-biz" };

function subObj(o: { id?: string; customer?: string; status?: string; packs?: number } = {}) {
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  const items = [{ price: { id: PRICES.base }, quantity: 1, current_period_end: end }];
  if (o.packs) items.push({ price: { id: PRICES.pack }, quantity: o.packs, current_period_end: end });
  return { id: o.id ?? "sub_1", object: "subscription", customer: o.customer ?? "cus_1", status: o.status ?? "active", cancel_at_period_end: false, metadata: { org_id: ORG }, items: { object: "list", data: items } };
}
async function deliver(type: string, object: unknown, id?: string) {
  const o = object as { object?: string; id?: string };
  if (o.object === "subscription" && o.id) stripeSubs[o.id] = object as Record<string, unknown>;
  const event = { id: id ?? `evt_${++seq}`, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await route.POST(new Request("http://localhost/api/stripe/billing-webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
  return res.status;
}
const invoice = (subId: string | null) => ({ id: "in_1", object: "invoice", customer: "cus_1", parent: subId ? { subscription_details: { subscription: subId } } : null });

/* ───────── D-004: Checkout guard ───────── */
test("D-004 checkout: a customer with a live subscription in Stripe is refused, our copy is synced, no Checkout session is created", async () => {
  Object.assign(sub(), { stripe_customer_id: "cus_1" }); // our row is still a trial: it is behind Stripe
  stripeSubs.sub_live = subObj({ id: "sub_live", packs: 1 });
  await assert.rejects(server.createCheckoutUrl(org, sub() as never, { extraLocations: 0, staffPacks: 0 }, "o@x.test"), /already have a subscription/);
  assert.equal(sub().status, "active", "local row caught up");
  assert.equal(sub().stripe_subscription_id, "sub_live");
  assert.ok(!stripeCalls.some((c) => c.path === "/v1/checkout/sessions"), "no second Checkout page was created");
});

test("D-004 checkout: an unpaid/paused subscription at Stripe still counts as live (an expired local row cannot buy a second one)", async () => {
  Object.assign(sub(), { status: "expired", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_unpaid" });
  stripeSubs.sub_unpaid = subObj({ id: "sub_unpaid", status: "unpaid" });
  // S-015: the refusal now points at Manage billing (the Customer Portal) instead of "use Change plan", which would refuse too
  await assert.rejects(server.createCheckoutUrl(org, sub() as never, { extraLocations: 0, staffPacks: 0 }, "o@x.test"), (e: unknown) => {
    assert.ok(e instanceof server.LiveSubscriptionError);
    assert.equal((e as InstanceType<typeof server.LiveSubscriptionError>).needsPortal, true);
    assert.match((e as Error).message, /Manage billing/);
    assert.match((e as Error).message, /unpaid invoice/);
    return true;
  });
  assert.ok(!stripeCalls.some((c) => c.path === "/v1/checkout/sessions"));
});

test("S-015: a healthy live subscription still just says to refresh and use Change plan (no Portal detour)", async () => {
  Object.assign(sub(), { stripe_customer_id: "cus_1" });
  stripeSubs.sub_live = subObj({ id: "sub_live" });
  await assert.rejects(server.createCheckoutUrl(org, sub() as never, { extraLocations: 0, staffPacks: 0 }, "o@x.test"), (e: unknown) => {
    assert.equal((e as { needsPortal?: boolean }).needsPortal, false);
    assert.match((e as Error).message, /Change plan/);
    return true;
  });
});

test("S-015: Change plan on an expired row whose Stripe subscription is still unpaid sends the owner to Manage billing; a dead one gets the plain message", async () => {
  Object.assign(sub(), { status: "expired", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_unpaid" });
  stripeSubs.sub_unpaid = subObj({ id: "sub_unpaid", status: "unpaid" });
  const r = await server.changePlan(ORG, sub() as never, { extraLocations: 0, staffPacks: 1 }, { locations: 1, staff: 1 });
  assert.equal(r.ok, false);
  assert.equal((r as { portal?: boolean }).portal, true);
  assert.match((r as { error: string }).error, /Manage billing/);
  stripeSubs.sub_unpaid = subObj({ id: "sub_unpaid", status: "incomplete_expired" });
  const r2 = await server.changePlan(ORG, sub() as never, { extraLocations: 0, staffPacks: 1 }, { locations: 1, staff: 1 });
  assert.equal(r2.ok, false);
  assert.equal((r2 as { portal?: boolean }).portal, undefined, "a subscription that never started is not an unpaid invoice");
  assert.match((r2 as { error: string }).error, /Subscribe first/);
});

test("D-004 checkout: a customer with only dead subscriptions may subscribe again; idempotent and short-lived Checkout; server-side prices", async () => {
  Object.assign(sub(), { status: "cancelled", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_old" });
  stripeSubs.sub_old = subObj({ id: "sub_old", status: "canceled" });
  const plan = { extraLocations: 1, staffPacks: 2 };
  const url1 = await server.createCheckoutUrl(org, sub() as never, plan, "o@x.test");
  const url2 = await server.createCheckoutUrl(org, sub() as never, plan, "o@x.test"); // a double click / second tab
  assert.equal(url1, url2, "same Checkout page returned (idempotency key)");
  const created = stripeCalls.filter((c) => c.path === "/v1/checkout/sessions");
  assert.equal(created.length, 2);
  assert.equal(created[0].idem, created[1].idem);
  const b = created[0].body;
  assert.equal(b.get("mode"), "subscription");
  assert.equal(b.get("client_reference_id"), ORG);
  assert.equal(b.get("line_items[0][price]"), PRICES.base);
  assert.equal(b.get("line_items[1][price]"), PRICES.location);
  assert.equal(b.get("line_items[1][quantity]"), "1");
  assert.equal(b.get("line_items[2][price]"), PRICES.pack);
  assert.equal(b.get("line_items[2][quantity]"), "2");
  const exp = Number(b.get("expires_at"));
  const now = Math.floor(Date.now() / 1000);
  assert.ok(exp >= now + 30 * 60 && exp <= now + 24 * 3600, `expires_at within Stripe's 30 min - 24 h window (was ${exp - now}s ahead)`);
  assert.ok(![...b.keys()].some((k) => /unit_amount|price_data/.test(k)), "no client-supplied amounts");
  // a different plan gets a different Checkout page
  const url3 = await server.createCheckoutUrl(org, sub() as never, { extraLocations: 0, staffPacks: 0 }, "o@x.test");
  assert.notEqual(url3, url1);
});

test("D-004 checkout: a customer is created once (idempotency key) and the id is remembered", async () => {
  await server.createCheckoutUrl(org, sub() as never, { extraLocations: 0, staffPacks: 0 }, "o@x.test");
  const made = stripeCalls.filter((c) => c.path === "/v1/customers");
  assert.equal(made.length, 1);
  assert.ok(made[0].idem && made[0].idem.includes(ORG));
  assert.equal(sub().stripe_customer_id, "cus_made");
});

/* ───────── D-012: emails ───────── */
test("D-012: three failed-payment retries send ONE email; payment fixed then a new failure sends another", async () => {
  await deliver("customer.subscription.created", subObj());
  assert.equal(emails.filter((e) => /subscription is active/.test(e.subject)).length, 1, "one 'started' email");
  emails.length = 0;
  for (let i = 0; i < 3; i++) {
    stripeSubs.sub_1 = subObj({ status: "past_due" });
    await deliver("invoice.payment_failed", { ...invoice("sub_1"), id: `in_${i}` });
  }
  assert.equal(sub().status, "past_due");
  assert.equal(emails.filter((e) => /couldn't take your Tempo payment/.test(e.subject)).length, 1, "one failure email for three retries");
  stripeSubs.sub_1 = subObj({ status: "active" });
  await deliver("invoice.paid", invoice("sub_1"));
  assert.equal(sub().status, "active");
  assert.equal(sub().past_due_since, null);
  emails.length = 0;
  stripeSubs.sub_1 = subObj({ status: "past_due" });
  await deliver("invoice.payment_failed", invoice("sub_1"));
  assert.equal(emails.filter((e) => /couldn't take your Tempo payment/.test(e.subject)).length, 1, "a new problem is announced again");
});

test("D-012: the same event delivered twice sends one email; webhook + Checkout-return race sends one 'started' email", async () => {
  const obj = subObj();
  assert.equal(await deliver("customer.subscription.created", obj, "evt_same"), 200);
  assert.equal(await deliver("customer.subscription.created", obj, "evt_same"), 200);
  assert.equal(emails.length, 1);
  // Checkout-return path after the webhook already made the plan active: no second 'started'
  emails.length = 0;
  const r = await server.applyStripeSubscription(subObj() as unknown as Stripe.Subscription, { orgHint: ORG, eventAt: Math.floor(Date.now() / 1000) });
  assert.equal(r?.started, false);
  assert.equal(emails.length, 0);
});

test("D-005: dates are pinned to the business time zone (evening in Vancouver is already the next day in UTC), bad zone falls back", async () => {
  const { formatDateLong } = await import("../../src/lib/billing");
  const end = "2026-11-16T04:30:00.000Z"; // 8:30 pm on the 15th in Vancouver, 11:30 pm the 15th in Toronto, 4:30 am the 16th in UTC
  assert.match(formatDateLong(end, "America/Vancouver"), /15/);
  assert.match(formatDateLong(end, "UTC"), /16/);
  assert.equal(formatDateLong(end, "Not/AZone"), formatDateLong(end, "America/Toronto"));
});

/* ───────── S-003 / duplicate subscription across customers ───────── */
test("S-003: once a business has a Stripe customer, a different customer naming it in metadata cannot take it over", async () => {
  await deliver("customer.subscription.created", subObj({ id: "sub_evil", customer: "cus_attacker" })); // metadata org = ORG, but ORG has no customer stored yet
  // a trial row with no customer accepts the first customer that claims it by metadata (documented hint behaviour):
  const first = sub().stripe_customer_id;
  await deliver("customer.subscription.created", subObj({ id: "sub_evil2", customer: "cus_other" }));
  assert.equal(sub().stripe_customer_id, first, "once a customer is stored, a different customer cannot take the business over");
});


/* ───────── S-016: a cancelled duplicate is refunded and the operator is told ───────── */
async function makeDuplicate(paid: boolean) {
  await deliver("customer.subscription.created", subObj({ id: "sub_1" }));
  assert.equal(sub().stripe_subscription_id, "sub_1");
  if (paid) {
    invoicesBySub.sub_2 = [{ id: "in_dup", object: "invoice", status: "paid", amount_paid: 1500 }];
    paymentsByInvoice.in_dup = [{ id: "inpay_1", object: "invoice_payment", status: "paid", amount_paid: 1500, payment: { type: "payment_intent", payment_intent: "pi_dup" } }];
  }
  emails.length = 0;
  stripeCalls.length = 0;
  return deliver("customer.subscription.created", subObj({ id: "sub_2" }), "evt_dup");
}
const refundCalls = () => stripeCalls.filter((c) => c.path === "/v1/refunds");

test("S-016: a duplicate subscription is cancelled AND its paid invoice is refunded, and the operator is emailed", async () => {
  assert.equal(await makeDuplicate(true), 200);
  assert.ok(stripeCalls.some((c) => c.m === "DELETE" && c.path === "/v1/subscriptions/sub_2"), "duplicate cancelled");
  assert.equal(refundCalls().length, 1, "exactly one refund");
  assert.equal(refundCalls()[0].body.get("payment_intent"), "pi_dup");
  assert.equal(refundCalls()[0].idem, "tempo-dup-refund-pi_dup", "the refund carries an idempotency key built from the payment");
  assert.equal(sub().stripe_subscription_id, "sub_1", "the customer's real subscription is untouched");
  assert.ok(!stripeCalls.some((c) => c.path.includes("sub_1") && c.m === "DELETE"));
  const alert = emails.find((e) => /Duplicate subscription cancelled and refunded/.test(e.subject));
  assert.ok(alert, "operator alert sent: " + emails.map((e) => e.subject).join("|"));
  assert.equal(alert.to, "ops@example.test");
});

test("S-016: delivering the duplicate again (a webhook retry) never refunds twice", async () => {
  await makeDuplicate(true);
  const first = refundsMade;
  assert.equal(first, 1);
  // Stripe retries the same logical news: the cancel is a no-op and the refund repeats with the same idempotency key
  stripeSubs.sub_2.status = "active"; // as if our first attempt had died before cancelling
  await deliver("customer.subscription.created", subObj({ id: "sub_2" }), "evt_dup_retry");
  assert.equal(refundsMade, 1, "Stripe's idempotency returned the same refund: no second refund was made");
  assert.ok(refundCalls().length >= 2 && new Set(refundCalls().map((c) => c.idem)).size === 1, "same key on every attempt");
});

test("S-016: when the refund can't be made, the webhook still succeeds and the alert says REFUND NEEDED", async () => {
  refundFails = true;
  assert.equal(await makeDuplicate(true), 200);
  assert.ok(emails.some((e) => /REFUND NEEDED/.test(e.subject)), "alert tells the operator to refund by hand: " + emails.map((e) => e.subject).join("|"));
  assert.equal(sub().stripe_subscription_id, "sub_1");
});

test("S-016: a duplicate that never paid is cancelled with nothing to refund (and the alert says so)", async () => {
  assert.equal(await makeDuplicate(false), 200);
  assert.equal(refundCalls().length, 0);
  assert.ok(emails.some((e) => /cancelled and refunded/.test(e.subject)));
});

/* ───────── S-014: fair reconciliation, missing subscriptions marked, no stale overwrite ───────── */
const orgId = (n: number) => `c${String(n).padStart(7, "0")}-0000-0000-0000-000000000000`;
const paying = (n: number, extra: Row = {}): Row => ({ ...trialRow(), org_id: orgId(n), status: "active", stripe_customer_id: `cus_${n}`, stripe_subscription_id: `sub_r${n}`, current_period_end: new Date(Date.now() + 5 * 86400_000).toISOString(), updated_at: "2026-10-01T00:00:00.000Z", ...extra });

test("S-014: 27 subscriptions Stripe no longer knows can't starve the 3 real ones: every row is visited within two sweeps", async () => {
  db.subscriptions = [];
  for (let n = 1; n <= 27; n++) db.subscriptions.push(paying(n)); // dead ids come FIRST in table order
  for (let n = 28; n <= 30; n++) { db.subscriptions.push(paying(n, { staff_packs: 0 })); stripeSubs[`sub_r${n}`] = { ...subObj({ id: `sub_r${n}`, customer: `cus_${n}`, packs: 3 }), metadata: { org_id: orgId(n) } }; }
  const first = await server.reconcileWithStripe();
  const visited = () => db.subscriptions.filter((r) => r.last_reconciled_at);
  assert.equal(visited().length, 25, "the batch is 25 and every one of them is stamped, found or not");
  const second = await server.reconcileWithStripe();
  assert.equal(visited().length, 30, "the next sweep takes the 5 not yet visited, not the same 25 again");
  for (let n = 28; n <= 30; n++) assert.equal(db.subscriptions.find((r) => r.org_id === orgId(n))!.staff_packs, 3, `real subscription ${n} was reconciled`);
  assert.equal(first + second, 3, "only the 3 real ones count as checked");
});

test("S-014: a subscription Stripe doesn't know is MARKED (stripe_missing_at) and logged, its plan is left alone; found again clears the mark", async () => {
  db.subscriptions = [paying(1)];
  await server.reconcileWithStripe();
  const row = db.subscriptions[0];
  assert.ok(row.stripe_missing_at, "marked missing");
  assert.equal(row.status, "active", "entitlement is not changed by a 404 (a wrong API key looks the same)");
  assert.ok(row.last_reconciled_at);
  const mark = row.stripe_missing_at;
  await server.reconcileWithStripe();
  assert.equal(row.stripe_missing_at, mark, "the first mark is kept");
  stripeSubs.sub_r1 = { ...subObj({ id: "sub_r1", customer: "cus_1" }), metadata: { org_id: orgId(1) } };
  await server.reconcileWithStripe();
  assert.equal(row.stripe_missing_at, null, "cleared once Stripe has it again");
});

test("S-014: a Stripe error for one row still stamps it (so it moves back in the queue) and the sweep carries on", async () => {
  db.subscriptions = [paying(1), paying(2)];
  stripeSubs.sub_r1 = { ...subObj({ id: "sub_r1", customer: "cus_1" }), metadata: { org_id: orgId(1) } };
  stripeSubs.sub_r2 = { ...subObj({ id: "sub_r2", customer: "cus_2", packs: 1 }), metadata: { org_id: orgId(2) } };
  stripeErrorFor = "sub_r1";
  const checked = await server.reconcileWithStripe();
  assert.equal(checked, 1, "only the healthy one counts as checked");
  assert.ok(db.subscriptions.every((r) => r.last_reconciled_at), "both rows were stamped, including the one Stripe errored on");
  assert.equal(db.subscriptions[1].staff_packs, 1, "the sweep carried on after the error");
  assert.equal(db.subscriptions[0].stripe_missing_at ?? null, null, "an error is not 'missing'");
});

test("S-014: a sweep that read Stripe before a webhook wrote can't overwrite the webhook's newer data (compare-and-set on updated_at)", async () => {
  db.subscriptions = [paying(1, { updated_at: "2026-10-01T00:00:00.000Z", staff_packs: 0 })];
  const older = { ...subObj({ id: "sub_r1", customer: "cus_1", packs: 1 }), metadata: { org_id: orgId(1) } } as unknown as Stripe.Subscription;
  // between the sweep's read of the row and its write, a webhook applies a newer plan (2 packs) and bumps updated_at
  beforeSubsWrite = () => { Object.assign(db.subscriptions[0], { staff_packs: 2, updated_at: "2026-10-01T00:00:05.000Z" }); };
  const r = await server.applyStripeSubscription(older, { orgHint: orgId(1) });
  assert.equal(db.subscriptions[0].staff_packs, 2, "the newer write survived");
  assert.equal(r?.changed, false);
  assert.equal(r?.started, false);
  // and with no concurrent write the same apply goes through
  await server.applyStripeSubscription(older, { orgHint: orgId(1) });
  assert.equal(db.subscriptions[0].staff_packs, 1);
});

/* ───────── D-017: the plan lookup for timed workflows ───────── */
test("D-017: timed workflows page the plan lookup and fail closed only for the business whose lookup fails", async () => {
  const { findPausedOrgs } = await import("../../src/lib/messaging");
  const { createAdminClient } = await import("../../src/lib/supabase/admin");
  const ids = Array.from({ length: 250 }, (_, i) => `d${String(i).padStart(7, "0")}-0000-0000-0000-000000000000`);
  const future = new Date(Date.now() + 5 * 86400_000).toISOString();
  db.subscriptions = ids.map((id, i) => ({ org_id: id, status: i === 7 ? "expired" : "active", trial_ends_at: future, current_period_end: future, cancel_at_period_end: false, past_due_since: null }));
  db.subscriptions.splice(9, 1); // org 9 has NO row at all: fail closed
  const now = new Date();
  const admin = createAdminClient();

  subsReads.length = 0;
  let paused = await findPausedOrgs(admin, ids, now);
  assert.deepEqual([...paused].sort(), [ids[7], ids[9]].sort(), "only the expired one and the one without a row are paused");
  assert.equal(subsReads.length, 3, "250 businesses are read in 3 chunks, not one giant list");
  assert.ok(subsReads.every((u) => (u.match(/d00000/g) ?? []).length <= 100), "no request carries more than 100 ids");

  // one chunk can't be read at all (database error): it is retried one business at a time, and only the business whose own lookup fails is paused
  failSubsRead = (u) => u.includes(ids[150]);
  paused = await findPausedOrgs(admin, ids, now);
  assert.ok(paused.has(ids[150]), "the failing business is paused for this run");
  assert.ok(!paused.has(ids[151]) && !paused.has(ids[100]) && !paused.has(ids[199]), "its neighbours in the same chunk still send");
  assert.ok(!paused.has(ids[0]) && !paused.has(ids[249]), "other chunks are unaffected");
  assert.equal(paused.size, 3, "expired + no row + the one failing business");
  failSubsRead = null;

  // everything fails: all are paused (fail closed), the run doesn't crash
  failSubsRead = () => true;
  paused = await findPausedOrgs(admin, ids.slice(0, 5), now);
  assert.equal(paused.size, 5);
});

/* ───────── D-018: grace expiry is sticky against reconcile and webhooks ───────── */
const activeEmails = () => emails.filter((e) => /subscription is active/.test(e.subject)).length;
function pastGraceRow() {
  Object.assign(sub(), {
    status: "past_due", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1",
    past_due_since: new Date(Date.now() - 9 * 86400_000).toISOString(), current_period_end: new Date(Date.now() + 5 * 86400_000).toISOString(),
    updated_at: "2026-10-01T00:00:00.000Z",
  });
  stripeSubs.sub_1 = subObj({ status: "past_due" }); // Stripe is still retrying the card
}

test("D-018: two consecutive sweeps after the grace period keep the row expired and send no 'active' email", async () => {
  pastGraceRow();
  const a = await server.runBillingSweep(new Date());
  assert.equal(a.expired, 1);
  assert.equal(sub().status, "expired");
  const b = await server.runBillingSweep(new Date(Date.now() + 3600_000));
  assert.equal(b.expired, 0);
  assert.equal(sub().status, "expired", "reconcile did not flip it back to past_due");
  assert.equal(activeEmails(), 0, "no 'subscription is active' email for a non-paying state");
  assert.equal(emails.filter((e) => /couldn't take your Tempo payment/.test(e.subject)).length, 0, "and no second failure email");
});

test("D-018: a late customer.subscription.updated(past_due) after grace expiry leaves the row expired and silent", async () => {
  pastGraceRow();
  await server.runBillingSweep(new Date());
  assert.equal(sub().status, "expired");
  assert.equal(await deliver("customer.subscription.updated", subObj({ status: "past_due" })), 200);
  assert.equal(await deliver("invoice.payment_failed", invoice("sub_1")), 200);
  assert.equal(sub().status, "expired");
  assert.equal(emails.length, 0);
});

test("D-018: paying the invoice (invoice.paid, Stripe says active) moves an expired row back to active", async () => {
  pastGraceRow();
  await server.runBillingSweep(new Date());
  assert.equal(sub().status, "expired");
  stripeSubs.sub_1 = subObj({ status: "active" });
  assert.equal(await deliver("invoice.paid", invoice("sub_1")), 200);
  assert.equal(sub().status, "active");
  assert.equal(sub().past_due_since, null);
  assert.equal(activeEmails(), 1, "recovery is announced once");
  // and a later sweep leaves it active
  await server.runBillingSweep(new Date(Date.now() + 3600_000));
  assert.equal(sub().status, "active");
  assert.equal(activeEmails(), 1);
});

/* ───────── S-018: a duplicate that loses the compare-and-set race is still cancelled and refunded ───────── */
test("S-018: when another webhook wins the write with a different live subscription, the loser is cancelled and refunded, not dropped", async () => {
  stripeSubs.sub_1 = subObj({ id: "sub_1" });
  invoicesBySub.sub_2 = [{ id: "in_dup", object: "invoice", status: "paid", amount_paid: 1500 }];
  paymentsByInvoice.in_dup = [{ id: "inpay_1", object: "invoice_payment", status: "paid", amount_paid: 1500, payment: { type: "payment_intent", payment_intent: "pi_dup" } }];
  // Both handlers read the row while it is still a trial; sub_1's write lands between sub_2's read and its write.
  beforeSubsWrite = () => { Object.assign(sub(), { status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", updated_at: "2026-10-18T00:00:00.000Z" }); };
  const r = await server.applyStripeSubscription(subObj({ id: "sub_2" }) as unknown as Stripe.Subscription, { orgHint: ORG });
  assert.equal(r, null);
  assert.ok(stripeCalls.some((c) => c.m === "DELETE" && c.path === "/v1/subscriptions/sub_2"), "duplicate cancelled");
  assert.equal(refundCalls().length, 1, "and refunded");
  assert.ok(emails.some((e) => /Duplicate subscription cancelled and refunded/.test(e.subject)), "operator told");
  assert.equal(sub().stripe_subscription_id, "sub_1", "the winner is untouched");
});

test("S-018: losing the race to a write of the SAME subscription is still just 'unchanged'", async () => {
  beforeSubsWrite = () => { Object.assign(sub(), { status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", updated_at: "2026-10-18T00:00:00.000Z" }); };
  const r = await server.applyStripeSubscription(subObj({ id: "sub_1" }) as unknown as Stripe.Subscription, { orgHint: ORG });
  assert.equal(r?.started, false);
  assert.ok(!stripeCalls.some((c) => c.m === "DELETE"));
});

test("S-020: when the race winner is already dead at Stripe, the live loser is adopted instead of left unapplied", async () => {
  stripeSubs.sub_1 = subObj({ id: "sub_1", status: "canceled" });
  beforeSubsWrite = () => { Object.assign(sub(), { status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", updated_at: "2026-10-18T00:00:00.000Z" }); };
  const r = await server.applyStripeSubscription(subObj({ id: "sub_2" }) as unknown as Stripe.Subscription, { orgHint: ORG });
  assert.ok(r);
  assert.equal(sub().stripe_subscription_id, "sub_2", "the live subscription took over");
  assert.equal(sub().status, "active");
  assert.ok(!stripeCalls.some((c) => c.m === "DELETE"), "nothing live was cancelled");
});

/* ───────── Portal configuration (shared Stripe account: never use the Default configuration) ───────── */
test("portal: Tempo's own configuration is passed to Stripe", async () => {
  Object.assign(sub(), { stripe_customer_id: "cus_1" });
  const url = await server.createPortalUrl(org, sub() as never, "o@x.test");
  assert.equal(url, "https://billing.stripe.test/p/session");
  const call = stripeCalls.find((c) => c.path === "/v1/billing_portal/sessions");
  assert.ok(call, "portal session requested");
  assert.equal(call.body.get("configuration"), "bpc_test_tempo");
});

test("portal: without STRIPE_PORTAL_CONFIGURATION it refuses with a friendly error and makes no Stripe call", async () => {
  const { env } = await import("../../src/lib/env");
  const saved = env.stripePortalConfiguration;
  env.stripePortalConfiguration = undefined;
  try {
    await assert.rejects(server.createPortalUrl(org, sub() as never, "o@x.test"), (e: unknown) => {
      assert.ok(e instanceof server.BillingUserError);
      assert.match((e as Error).message, /Billing portal isn't set up yet/);
      return true;
    });
    assert.equal(stripeCalls.length, 0, "no Stripe call (not even customer creation), so no Default-configuration portal");
  } finally { env.stripePortalConfiguration = saved; }
});
