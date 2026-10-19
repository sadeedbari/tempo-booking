// Local stand-ins for Resend (email), Twilio (SMS) and Stripe, so end-to-end tests can check what Tempo
// would have sent without emailing, texting or charging anyone.
//
//   node e2e/mock-services.mjs            (listens on 127.0.0.1:4010)
//   GET    /__sent                         everything captured so far
//   DELETE /__sent                         forget it
//   POST   /__mode  {"resend":"fail"}      make a service fail ("ok" to recover). Keys: resend, twilio, refund, connect,
//                                          checkout, portal, subupdate ("fail" = a 400 whose raw text must never reach a browser;
//                                          subupdate also takes "card" = a declined card)
//   GET    /pay/<session>                  a stand-in Stripe Checkout page: "Pay" completes the session (creates the subscription)
//                                          and goes to the success URL, "Cancel" goes to the cancel URL
//   GET    /portal/<customer>?return=<url> a stand-in Customer Portal page with a link back to Tempo
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 4010);
const sent = { emails: [], sms: [], stripe: [] };
// Subscription billing stand-in state (Tempo's own Stripe account, not Connect).
const billing = { sessions: {}, subs: {} };
const mode = { resend: "ok", twilio: "ok", refund: "ok", connect: "restricted", checkout: "ok", portal: "ok", subupdate: "ok" };
// Text that looks like what Stripe puts in raw errors: the app must replace it with its own sentence (S-005).
const RAW = "mock raw stripe error: No such price: price_mock_base; key sk_test_mockLEAK; req_mockLEAK";
let n = 0;
const seen = new Map(); // idempotency key -> first answer

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
const html = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "text/html" });
  res.end(`<!doctype html><title>mock</title>${body}`);
};
const form = (s) => Object.fromEntries(new URLSearchParams(s));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = url.pathname;
    const raw = await readBody(req);

    // ---- control
    if (path === "/__sent") {
      if (req.method === "DELETE") { sent.emails.length = sent.sms.length = sent.stripe.length = 0; seen.clear(); return json(res, 200, { ok: true }); }
      return json(res, 200, sent);
    }
    // ---- billing test controls: make a subscription exist in the stand-in Stripe, and finish a Checkout session
    //   POST /__subscription {customer, items:[{price,quantity}], status?, cancel_at_period_end?, org?, replace?} -> the subscription
    //   POST /__subscription/<id> {status?, items?, cancel_at_period_end?}  change one (as Stripe would before sending an event)
    //   POST /__session_complete {session, subscription}
    if (path === "/__subscription" && req.method === "POST") {
      const b = JSON.parse(raw || "{}");
      // replace: forget this customer's other subscriptions first (a test moving a team to a new state; Stripe would hold one)
      if (b.replace) for (const [k, v] of Object.entries(billing.subs)) if (v.customer === b.customer) delete billing.subs[k];
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

    // ---- stand-in Checkout and Portal pages (a browser lands here)
    const pay = path.match(/^\/pay\/([^/]+)(?:\/(complete|cancel))?$/);
    if (pay && req.method === "GET") {
      const s = billing.sessions[pay[1]];
      if (!s) return html(res, 404, "<h1>No such session</h1>");
      if (!pay[2]) return html(res, 200, `<h1>Mock Stripe Checkout</h1><p id="amount">${s.summary}</p><a id="pay" href="/pay/${s.id}/complete">Pay</a> <a id="cancel" href="/pay/${s.id}/cancel">Cancel</a>`);
      if (pay[2] === "cancel") { res.writeHead(302, { Location: s.cancel_url }); return res.end(); }
      if (!s.subscription) {
        const id = `sub_mock_${++n}`;
        billing.subs[id] = subObject(id, { customer: s.customer, org: s.metadata.org_id, items: s.items });
        s.subscription = id;
      }
      s.status = "complete";
      res.writeHead(302, { Location: s.success_url.replace("{CHECKOUT_SESSION_ID}", s.id) });
      return res.end();
    }
    const por = path.match(/^\/portal\/([^/]+)$/);
    if (por && req.method === "GET") return html(res, 200, `<h1>Mock Stripe Customer Portal</h1><p id="customer">${por[1]}</p><a id="back" href="${url.searchParams.get("return") ?? "/"}">Return to Tempo</a>`);

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
      const idem = req.headers["idempotency-key"] ?? null;
      sent.stripe.push({ method: req.method, path, body, account: req.headers["stripe-account"] ?? null, idem });
      // Like Stripe: the same idempotency key on a POST returns the first answer instead of creating another object.
      if (idem && req.method === "POST" && seen.has(idem)) return json(res, 200, seen.get(idem));
      const reply = (obj) => { if (idem && req.method === "POST") seen.set(idem, obj); return json(res, 200, obj); };
      const base = `http://127.0.0.1:${PORT}`;
      if (path === "/v1/customers" && req.method === "POST") return reply({ id: `cus_mock_${++n}`, object: "customer", metadata: { org_id: body["metadata[org_id]"] } });
      if (path === "/v1/billing_portal/sessions" && req.method === "POST") {
        // Tempo must always name its own portal configuration (the Stripe account is shared); reject a call that doesn't.
        if (!/^bpc_/.test(body.configuration ?? "")) return json(res, 400, { error: { type: "invalid_request_error", message: "mock: portal configuration missing" } });
      }
      if (path === "/v1/billing_portal/sessions" && req.method === "POST" && mode.portal === "fail") return json(res, 400, { error: { type: "invalid_request_error", message: RAW } });
      if (path === "/v1/billing_portal/sessions" && req.method === "POST") return json(res, 200, { id: `bps_mock_${++n}`, object: "billing_portal.session", url: `${base}/portal/${body.customer}?return=${encodeURIComponent(body.return_url ?? "")}` });
      if (path === "/v1/checkout/sessions" && req.method === "POST" && body.mode === "subscription" && mode.checkout === "fail") return json(res, 400, { error: { type: "invalid_request_error", message: RAW } });
      if (path === "/v1/checkout/sessions" && req.method === "POST" && body.mode === "subscription") {
        const id = `cs_mock_${++n}`;
        const items = [];
        for (let i = 0; body[`line_items[${i}][price]`]; i++) items.push({ price: body[`line_items[${i}][price]`], quantity: Number(body[`line_items[${i}][quantity]`]) });
        billing.sessions[id] = { id, object: "checkout.session", mode: "subscription", status: "open", customer: body.customer, client_reference_id: body.client_reference_id, metadata: { org_id: body["metadata[org_id]"] }, subscription: null, url: `${base}/pay/${id}`, success_url: body.success_url, cancel_url: body.cancel_url, items, summary: items.map((i) => `${i.price} x ${i.quantity}`).join(", ") };
        return reply(billing.sessions[id]);
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
        if (req.method === "POST" && mode.subupdate === "fail") return json(res, 400, { error: { type: "invalid_request_error", message: RAW } });
        if (req.method === "POST" && mode.subupdate === "card") return json(res, 402, { error: { type: "card_error", code: "card_declined", message: RAW } });
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
