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
