// The hourly job, workflow messages, and the Stripe webhook, checked against a local Tempo whose email, text and
// Stripe are stand-ins (e2e/mock-services.mjs), so we can see exactly what would have been sent.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { admin, APP, mock, st } from "./util.mjs";
import { secrets } from "../lib.mjs";

const cron = (auth = `Bearer ${secrets.cron}`) => fetch(`${APP}/api/cron/reminders`, { headers: auth ? { Authorization: auth } : {} });
const H = 3600_000;
const BASE = Date.now(); // fixed, so staggered test bookings keep their spacing however long the run takes
let n = 0;

async function customer({ phone = null, consent = false } = {}) {
  const email = `sys${Date.now().toString(36)}${++n}@customers.tempo-e2e.test`;
  const { data } = await admin.from("customers").insert({ org_id: st.orgA.id, name: "Sys Customer", email, phone, sms_consent_at: consent ? new Date().toISOString() : null }).select("id, email").single();
  return data;
}
async function bookingAt(startsInMs, o = {}) {
  const c = o.customer ?? (await customer());
  const start = new Date(BASE + startsInMs + ++n * 61_000); // staggered so test bookings never overlap
  const end = new Date(start.getTime() + (o.minutes ?? 0.1) * 60_000);
  const { data, error } = await admin.from("bookings").insert({
    org_id: st.orgA.id, member_id: o.member ?? st.orgA.members.sara, service_id: o.service ?? st.orgA.services.haircut, service_name: "Haircut",
    customer_id: c.id, starts_at: start.toISOString(), ends_at: end.toISOString(), blocked_until: end.toISOString(),
    status: o.status ?? "confirmed", price_cents: 8500, currency: "CAD", source: "manual", location_id: st.orgA.locations.qw,
    created_at: o.createdAt ?? new Date(Date.now() - 5 * 24 * H).toISOString(), // booked well before, so the reminder isn't skipped as "too late"
  }).select("id, manage_token").single();
  assert.equal(error, null, error?.message);
  return { ...data, customer: c };
}
const emailsTo = (sent, addr) => sent.emails.filter((e) => [].concat(e.to).includes(addr));

beforeEach(async () => { await mock.clear(); await mock.mode({ resend: "ok", twilio: "ok", refund: "ok" }); });

test("the hourly job refuses callers without the secret", async () => {
  assert.equal((await cron(null)).status, 401);
  assert.equal((await cron("Bearer wrong")).status, 401);
  assert.equal((await cron("Basic abc")).status, 401);
  const ok = await cron();
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});

test("a reminder goes out once, from the business, with the manage link; running the job again doesn't repeat it", async () => {
  const b = await bookingAt(20 * H); // inside the default 24 hour reminder window
  await cron();
  const sent = await mock.sent();
  const mails = emailsTo(sent, b.customer.email);
  assert.equal(mails.length, 1, `reminders: ${mails.length}`);
  assert.match(mails[0].subject, /^Reminder: Haircut at E2E Salon$/);
  assert.match(mails[0].from, /^E2E Salon <.+@.+>$/, "the business shows as the sender");
  assert.ok(mails[0].html.includes(`/booking/${b.manage_token}`), "manage link present");
  assert.ok(!/\{\{/.test(mails[0].html + mails[0].text), "no unfilled variables");
  await cron();
  assert.equal(emailsTo(await mock.sent(), b.customer.email).length, 1, "no duplicate on the next run");
  const { data: log } = await admin.from("message_log").select("status, channel, workflow_name").eq("booking_id", b.id);
  assert.deepEqual(log.map((l) => `${l.channel}:${l.status}`), ["email:sent"]);
});

test("a reminder isn't sent for far-off, cancelled, unapproved or already-started bookings, or ones made after the reminder time", async () => {
  const far = await bookingAt(40 * H);
  const cancelled = await bookingAt(20 * H, { status: "cancelled" });
  const pending = await bookingAt(20 * H, { status: "pending_approval", service: st.orgA.services.homevisit, member: st.orgA.members.sam });
  const started = await bookingAt(-2 * H);
  const late = await bookingAt(20 * H, { createdAt: new Date().toISOString() }); // booked just now for tomorrow
  await cron();
  const sent = await mock.sent();
  for (const [name, b] of Object.entries({ far, cancelled, pending, started, late })) assert.equal(emailsTo(sent, b.customer.email).length, 0, `${name} got a reminder`);
});

test("text reminders need the customer's agreement and a valid number, and always end with the opt-out line", async () => {
  const yes = await bookingAt(21 * H, { customer: await customer({ phone: "(416) 555-0142", consent: true }) });
  const noConsent = await bookingAt(21.5 * H, { customer: await customer({ phone: "4165550143", consent: false }), member: st.orgA.members.olivia });
  const badNumber = await bookingAt(22 * H, { customer: await customer({ phone: "12345", consent: true }), member: st.orgA.members.sara });
  await cron();
  const sent = await mock.sent();
  assert.equal(sent.sms.length, 1, `texts sent: ${sent.sms.length}`);
  assert.equal(sent.sms[0].To, "+14165550142");
  assert.match(sent.sms[0].Body, /^E2E Salon: Reminder - Haircut, .+ at .+\. Manage: https?:\/\/.+\/booking\/[a-f0-9]{48} Reply STOP to opt out\.$/);
  assert.ok(!/[–—‘’“”]/.test(sent.sms[0].Body), "plain characters only");
  for (const b of [noConsent, badNumber]) assert.equal(emailsTo(sent, b.customer.email).length, 1, "they still get the email");
  assert.equal(yes.customer.email.length > 0, true);
});

test("rescheduling a booking earns it a fresh reminder for the new time", async () => {
  const b = await bookingAt(20 * H);
  await cron();
  assert.equal(emailsTo(await mock.sent(), b.customer.email).length, 1);
  await admin.from("bookings").update({ starts_at: new Date(Date.now() + 18 * H).toISOString(), ends_at: new Date(Date.now() + 19 * H).toISOString(), blocked_until: new Date(Date.now() + 19 * H).toISOString() }).eq("id", b.id);
  await cron();
  assert.equal(emailsTo(await mock.sent(), b.customer.email).length, 2);
});

test("a custom workflow: 'thank you' two hours after the appointment, only for the chosen service", async () => {
  const wf = await admin.from("workflows").insert({ org_id: st.orgA.id, name: "e2e thank you", trigger: "after_end", offset_minutes: 120, all_services: false, position: 50 }).select("id").single();
  await admin.from("workflow_services").insert({ workflow_id: wf.data.id, service_id: st.orgA.services.haircut });
  await admin.from("workflow_steps").insert({ workflow_id: wf.data.id, org_id: st.orgA.id, channel: "email", subject: "Thanks, {{customer_first_name}}!", body: "Hi {{customer_first_name}}, thanks for {{service_name}} with {{staff_name}}.\nWhere: {{location}}\nDeposit: {{deposit}}\n\n{{booking_button}}", position: 0 });
  const done = await bookingAt(-5 * H, { status: "completed" }); // ended ~4h ago
  const recent = await bookingAt(-1.5 * H, { status: "confirmed" }); // ended ~30 min ago: not yet
  const other = await bookingAt(-5 * H, { status: "completed", service: st.orgA.services.consult, member: st.orgA.members.olivia });
  await cron();
  const sent = await mock.sent();
  const m = emailsTo(sent, done.customer.email).filter((e) => /^Thanks, Sys!$/.test(e.subject));
  assert.equal(m.length, 1);
  assert.ok(m[0].text.includes("thanks for Haircut with Sara Stylist"));
  assert.ok(m[0].text.includes("Where: Queen West, 214 Queen St W, Toronto"), m[0].text);
  assert.ok(!/Deposit:/.test(m[0].text), "empty lines drop out");
  assert.ok(/Book again/.test(m[0].html) && m[0].html.includes("/e2e-salon"), "button links back to the booking page");
  assert.equal(emailsTo(sent, recent.customer.email).filter((e) => /Thanks/.test(e.subject)).length, 0, "too soon");
  assert.equal(emailsTo(sent, other.customer.email).filter((e) => /Thanks/.test(e.subject)).length, 0, "other service isn't covered");
  await admin.from("workflows").update({ active: false }).eq("id", wf.data.id);
  const again = await bookingAt(-6 * H, { status: "completed" });
  await mock.clear(); await cron();
  assert.equal(emailsTo(await mock.sent(), again.customer.email).filter((e) => /Thanks/.test(e.subject)).length, 0, "switched off");
});

test("turning the reminder workflow off stops reminders; a message that fails is logged, never crashes the job", async () => {
  const { data: wf } = await admin.from("workflows").select("id").eq("org_id", st.orgA.id).eq("default_key", "reminder").single();
  await admin.from("workflows").update({ active: false }).eq("id", wf.id);
  const off = await bookingAt(19 * H);
  await cron();
  assert.equal(emailsTo(await mock.sent(), off.customer.email).length, 0);
  await admin.from("workflows").update({ active: true }).eq("id", wf.id);
  await mock.mode({ resend: "fail" });
  const failing = await bookingAt(19.5 * H);
  const res = await cron();
  assert.equal(res.status, 200, "the job survives a failing email service");
  const { data: log } = await admin.from("message_log").select("status, detail").eq("booking_id", failing.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].status, "failed");
  assert.match(log[0].detail, /mock email failure/);
});

test("housekeeping: unpaid holds are released, lapsed requests are closed, finished bookings complete", async () => {
  const hold = await bookingAt(48 * H, { status: "pending_payment", createdAt: new Date(Date.now() - 2 * H).toISOString() });
  const freshHold = await bookingAt(49 * H, { status: "pending_payment", createdAt: new Date().toISOString(), member: st.orgA.members.olivia });
  const lapsed = await bookingAt(-1 * H, { status: "pending_approval", service: st.orgA.services.homevisit, member: st.orgA.members.sam });
  const old = await bookingAt(-30 * H, { status: "confirmed", member: st.orgA.members.olivia });
  await cron();
  const get = async (id) => (await admin.from("bookings").select("status, cancel_reason").eq("id", id).single()).data;
  assert.equal((await get(hold.id)).status, "cancelled");
  assert.equal((await get(freshHold.id)).status, "pending_payment", "a hold made just now is kept");
  const l = await get(lapsed.id);
  assert.equal(l.status, "cancelled"); assert.match(l.cancel_reason, /not confirmed in time/i);
  assert.equal((await get(old.id)).status, "completed");
  assert.equal(emailsTo(await mock.sent(), lapsed.customer.email).filter((e) => /Update on your request/.test(e.subject)).length, 1, "the customer is told");
});

/* ───────────── Stripe webhook ───────────── */
const sign = (payload, secret = secrets.webhook) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
};
const hook = (event, signature) => fetch(`${APP}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": signature ?? sign(JSON.stringify(event)), "content-type": "application/json" }, body: JSON.stringify(event) });
const checkoutEvent = (type, bookingId, account = "acct_e2e_hook", paid = true) => ({
  id: `evt_${Date.now()}${++n}`, object: "event", type, account, api_version: "2024-06-20", created: Math.floor(Date.now() / 1000),
  data: { object: { id: "cs_test_x", object: "checkout.session", payment_status: paid ? "paid" : "unpaid", metadata: { booking_id: bookingId } } },
});

test("Stripe webhook: unsigned or wrongly signed calls are refused", async () => {
  const ev = checkoutEvent("checkout.session.completed", "00000000-0000-0000-0000-000000000000");
  assert.equal((await hook(ev, "")).status, 400);
  assert.equal((await hook(ev, "t=1,v1=deadbeef")).status, 400);
  assert.equal((await hook(ev, sign(JSON.stringify(ev), "whsec_wrong"))).status, 400);
  assert.equal((await fetch(`${APP}/api/stripe/webhook`, { method: "POST", body: "not json" })).status, 400);
});

test("Stripe webhook: a paid deposit confirms the booking once, from the right account only", async () => {
  await admin.from("organizations").update({ stripe_account_id: "acct_e2e_hook", stripe_charges_enabled: true }).eq("id", st.orgA.id);
  try {
    const b = await bookingAt(72 * H, { status: "pending_payment", createdAt: new Date().toISOString() });
    // wrong account: ignored
    assert.equal((await hook(checkoutEvent("checkout.session.completed", b.id, "acct_someone_else"))).status, 200);
    assert.equal((await admin.from("bookings").select("status").eq("id", b.id).single()).data.status, "pending_payment");
    // unpaid session: ignored
    await hook(checkoutEvent("checkout.session.completed", b.id, "acct_e2e_hook", false));
    assert.equal((await admin.from("bookings").select("status").eq("id", b.id).single()).data.status, "pending_payment");
    // the real thing
    await mock.clear();
    assert.equal((await hook(checkoutEvent("checkout.session.completed", b.id))).status, 200);
    const after = (await admin.from("bookings").select("status, payment_status").eq("id", b.id).single()).data;
    assert.deepEqual(after, { status: "confirmed", payment_status: "paid" });
    const mails = emailsTo(await mock.sent(), b.customer.email);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /^Confirmed:/);
    // replaying the same event doesn't send it again
    assert.equal((await hook(checkoutEvent("checkout.session.completed", b.id))).status, 200);
    assert.equal(emailsTo(await mock.sent(), b.customer.email).length, 1);
    // a request-only service goes to approval instead
    const req = await bookingAt(73 * H, { status: "pending_payment", createdAt: new Date().toISOString(), service: st.orgA.services.homevisit, member: st.orgA.members.sam });
    await hook(checkoutEvent("checkout.session.completed", req.id));
    assert.equal((await admin.from("bookings").select("status").eq("id", req.id).single()).data.status, "pending_approval");
    // an expired checkout frees the slot
    const exp = await bookingAt(74 * H, { status: "pending_payment", createdAt: new Date().toISOString(), member: st.orgA.members.olivia });
    await hook(checkoutEvent("checkout.session.expired", exp.id));
    assert.equal((await admin.from("bookings").select("status").eq("id", exp.id).single()).data.status, "cancelled");
    // unknown events and unknown bookings are accepted quietly
    assert.equal((await hook({ ...checkoutEvent("customer.created", b.id), type: "customer.created" })).status, 200);
    assert.equal((await hook(checkoutEvent("checkout.session.completed", "00000000-0000-0000-0000-000000000000"))).status, 200);
  } finally {
    await admin.from("organizations").update({ stripe_account_id: null, stripe_charges_enabled: false }).eq("id", st.orgA.id);
  }
});
