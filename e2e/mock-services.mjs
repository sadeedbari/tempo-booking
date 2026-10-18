// Local stand-ins for Resend (email), Twilio (SMS) and Stripe, so end-to-end tests can check what Tempo
// would have sent without emailing, texting or charging anyone.
//
//   node e2e/mock-services.mjs            (listens on 127.0.0.1:4010)
//   GET    /__sent                         everything captured so far
//   DELETE /__sent                         forget it
//   POST   /__mode  {"resend":"fail"}      make a service fail ("ok" to recover). Keys: resend, twilio, refund, connect
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 4010);
const sent = { emails: [], sms: [], stripe: [] };
// Subscription billing stand-in state (Tempo's own Stripe account, not Connect).
const billing = { sessions: {}, subs: {} };
const mode = { resend: "ok", twilio: "ok", refund: "ok", connect: "restricted" };
let n = 0;

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
const json = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};
const subObject = (id, b) => ({
  id, object: "subscription", customer: b.customer, status: b.status ?? "active", cancel_at_period_end: Boolean(b.cancel_at_period_end),
  metadata: b.org ? { org_id: b.org } : {},
  items: { object: "list", data: (b.items ?? []).map((i, k) => ({ id: `si_mock_${id}_${k}`, price: { id: i.price }, quantity: i.quantity, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 })) },
});
const form = (s) => Object.fromEntries(new URLSearchParams(s));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = url.pathname;
    const raw = await readBody(req);

    // ---- control
    if (path === "/__sent") {
      if (req.method === "DELETE") { sent.emails.length = sent.sms.length = sent.stripe.length = 0; return json(res, 200, { ok: true }); }
      return json(res, 200, sent);
    }
    // ---- billing test controls: make a subscription exist in the stand-in Stripe, and finish a Checkout session
    //   POST /__subscription {customer, items:[{price,quantity}], status?, cancel_at_period_end?, org?} -> the subscription
    //   POST /__subscription/<id> {status?, items?, cancel_at_period_end?}  change one (as Stripe would before sending an event)
    //   POST /__session_complete {session, subscription}
    if (path === "/__subscription" && req.method === "POST") {
      const b = JSON.parse(raw || "{}");
      const id = `sub_mock_${++n}`;
      return json(res, 200, (billing.subs[id] = subObject(id, b)));
    }
    const subCtl = path.match(/^\/__subscription\/([^/]+)$/);
    if (subCtl && req.method === "POST") {
      const cur = billing.subs[subCtl[1]];
      if (!cur) return json(res, 404, { error: "no such subscription" });
      const b = JSON.parse(raw || "{}");
      if (b.status) cur.status = b.status;
      if (typeof b.cancel_at_period_end === "boolean") cur.cancel_at_period_end = b.cancel_at_period_end;
      if (b.items) cur.items.data = subObject(cur.id, { ...b, customer: cur.customer }).items.data;
      return json(res, 200, cur);
    }
    if (path === "/__session_complete" && req.method === "POST") {
      const b = JSON.parse(raw || "{}");
      if (billing.sessions[b.session]) { billing.sessions[b.session].subscription = b.subscription; billing.sessions[b.session].status = "complete"; }
      return json(res, 200, billing.sessions[b.session] ?? {});
    }
    if (path === "/__mode") { Object.assign(mode, raw ? JSON.parse(raw) : {}); return json(res, 200, mode); }

    // ---- Resend
    if (path === "/emails" && req.method === "POST") {
      const body = JSON.parse(raw || "{}");
      if (mode.resend === "fail") return json(res, 422, { statusCode: 422, name: "validation_error", message: "mock email failure" });
      sent.emails.push(body);
      return json(res, 200, { id: `em_${++n}` });
    }

    // ---- Twilio
    const tw = path.match(/^\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/);
    if (tw && req.method === "POST") {
      const body = form(raw);
      if (mode.twilio === "fail") return json(res, 400, { code: 30032, message: "mock sms failure", status: 400 });
      sent.sms.push(body);
      return json(res, 201, { sid: `SM${++n}`, status: "queued" });
    }

    // ---- Stripe (only the calls Tempo makes)
    if (path.startsWith("/v1/") || path.startsWith("/v2/")) {
      const body = raw && raw.startsWith("{") ? JSON.parse(raw) : form(raw);
      sent.stripe.push({ method: req.method, path, body, account: req.headers["stripe-account"] ?? null });
      const base = `http://127.0.0.1:${PORT}`;
      if (path === "/v1/customers" && req.method === "POST") return json(res, 200, { id: `cus_mock_${++n}`, object: "customer", metadata: { org_id: body["metadata[org_id]"] } });
      if (path === "/v1/billing_portal/sessions" && req.method === "POST") return json(res, 200, { id: `bps_mock_${++n}`, object: "billing_portal.session", url: `${base}/portal/${body.customer}` });
      if (path === "/v1/checkout/sessions" && req.method === "POST" && body.mode === "subscription") {
        const id = `cs_mock_${++n}`;
        billing.sessions[id] = { id, object: "checkout.session", mode: "subscription", status: "open", customer: body.customer, client_reference_id: body.client_reference_id, metadata: { org_id: body["metadata[org_id]"] }, subscription: null, url: `${base}/pay/${id}` };
        return json(res, 200, billing.sessions[id]);
      }
      // list a customer's subscriptions (the app checks Stripe before starting a second Checkout)
      if (path === "/v1/subscriptions" && req.method === "GET") {
        const customer = new URL(req.url, "http://x").searchParams.get("customer");
        return json(res, 200, { object: "list", url: "/v1/subscriptions", has_more: false, data: Object.values(billing.subs).filter((x) => x.customer === customer) });
      }
      const sub = path.match(/^\/v1\/subscriptions\/([^/]+)$/);
      if (sub && billing.subs[sub[1]]) {
        const cur = billing.subs[sub[1]];
        if (req.method === "GET") return json(res, 200, cur);
        if (req.method === "DELETE") { cur.status = "canceled"; return json(res, 200, cur); }
        if (req.method === "POST") {
          if (body.cancel_at_period_end !== undefined) cur.cancel_at_period_end = body.cancel_at_period_end === "true";
          const upd = {};
          for (const [k, v] of Object.entries(body)) { const m = k.match(/^items\[(\d+)\]\[(\w+)\]$/); if (m) (upd[m[1]] ??= {})[m[2]] = v; }
          for (const u of Object.values(upd)) {
            const at = u.id ? cur.items.data.findIndex((i) => i.id === u.id) : -1;
            if (u.deleted === "true" && at >= 0) cur.items.data.splice(at, 1);
            else if (at >= 0) cur.items.data[at].quantity = Number(u.quantity);
            else if (u.price) cur.items.data.push({ id: `si_mock_${++n}`, price: { id: u.price }, quantity: Number(u.quantity), current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
          }
          return json(res, 200, cur);
        }
      }
      const bcs = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
      if (bcs && req.method === "GET" && billing.sessions[bcs[1]]) return json(res, 200, billing.sessions[bcs[1]]);
      if (path === "/v1/checkout/sessions" && req.method === "POST") {
        const id = `cs_mock_${++n}`;
        return json(res, 200, { id, object: "checkout.session", url: `${base}/pay/${id}`, payment_intent: `pi_mock_${n}`, payment_status: "unpaid" });
      }
      const cs = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
      if (cs && req.method === "GET") return json(res, 200, { id: cs[1], object: "checkout.session", payment_intent: `pi_for_${cs[1]}`, payment_status: "paid" });
      if (path === "/v1/refunds" && req.method === "POST") {
        if (mode.refund === "fail") return json(res, 400, { error: { type: "invalid_request_error", message: "mock refund failure" } });
        return json(res, 200, { id: `re_mock_${++n}`, object: "refund", status: "succeeded" });
      }
      if (path === "/v2/core/accounts" && req.method === "POST") return json(res, 200, { id: `acct_mock_${++n}`, object: "v2.core.account" });
      if (path === "/v2/core/account_links" && req.method === "POST") return json(res, 200, { object: "v2.core.account_link", url: `${base}/onboard/${n}` });
      const acct = path.match(/^\/v2\/core\/accounts\/([^/]+)$/);
      if (acct && req.method === "GET") {
        return json(res, 200, { id: acct[1], object: "v2.core.account", configuration: { merchant: { capabilities: { card_payments: { status: mode.connect } } } } });
      }
      return json(res, 404, { error: { type: "invalid_request_error", message: `mock has no ${req.method} ${path}` } });
    }

    json(res, 404, { error: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock services on http://127.0.0.1:${PORT}`));
