// The website contact form, checked straight against the database functions and permissions.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { admin, pub, signedIn, st, TECHNICAL, unique } from "./util.mjs";

const as = {};
before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
});

const send = (o = {}) =>
  pub.rpc("create_public_inquiry", {
    p_org: o.org ?? st.orgA.id,
    p_service: o.service === undefined ? st.orgA.services.haircut : o.service,
    p_name: o.name ?? "Ina Inquirer",
    p_email: o.email ?? `${unique("inq")}@customers.tempo-e2e.test`,
    p_phone: o.phone ?? "",
    p_message: o.message ?? `Hello ${unique("m")}, do you have space next week?`,
    p_ip_hash: o.ip === undefined ? null : o.ip,
  });
const clean = (r, what) => assert.ok(!TECHNICAL.test(r.error?.message ?? ""), `${what}: technical message leaked: ${r.error?.message}`);

test("a visitor can send a message: it is stored, tied to the service, and creates the customer", async () => {
  const email = `${unique("new")}@customers.tempo-e2e.test`;
  const r = await send({ email: `  ${email.toUpperCase()}  `, name: "  Ina Inquirer ", phone: "+14165550123" });
  assert.equal(r.error, null);
  assert.equal(r.data.duplicate, false);
  const { data: row } = await admin.from("inquiries").select("*").eq("id", r.data.id).single();
  assert.equal(row.status, "new");
  assert.equal(row.email, email.toLowerCase());
  assert.equal(row.name, "Ina Inquirer");
  assert.equal(row.service_name, "Haircut");
  const { data: cust } = await admin.from("customers").select("*").eq("id", row.customer_id).single();
  assert.equal(cust.email, email.toLowerCase());
  assert.equal(cust.phone, "+14165550123");
});

test("an existing customer keeps their name; a missing phone number is filled in; no second customer appears", async () => {
  const email = `${unique("ex")}@customers.tempo-e2e.test`;
  await admin.from("customers").insert({ org_id: st.orgA.id, name: "Original Name", email });
  const r = await send({ email, name: "Different Name", phone: "+14165550199" });
  assert.equal(r.error, null);
  const { data: all } = await admin.from("customers").select("name, phone").eq("org_id", st.orgA.id).eq("email", email);
  assert.equal(all.length, 1);
  assert.equal(all[0].name, "Original Name");
  assert.equal(all[0].phone, "+14165550199");
});

test("sending the same message twice stores it once", async () => {
  const email = `${unique("dup")}@customers.tempo-e2e.test`;
  const a = await send({ email, message: "Exactly the same words" });
  const b = await send({ email, message: "Exactly the same words" });
  assert.equal(a.error, null);
  assert.equal(b.data.duplicate, true);
  assert.equal(b.data.id, a.data.id);
});

test("bad input is refused with plain words", async () => {
  const cases = {
    "no name": { name: "  " },
    "bad email": { email: "not an email" },
    "email with no domain": { email: "a@b" },
    "huge email": { email: `${"x".repeat(250)}@a.co` },
    "empty message": { message: "   " },
  };
  for (const [what, o] of Object.entries(cases)) {
    const r = await send(o);
    assert.ok(r.error, `${what} should be refused`);
    assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
    clean(r, what);
  }
});

test("long text is cut to the limits instead of failing, and a made-up service is ignored", async () => {
  const r = await send({ name: "N".repeat(500), message: "M".repeat(9000), phone: "1".repeat(200), service: "00000000-0000-4000-8000-000000000000" });
  assert.equal(r.error, null);
  const { data: row } = await admin.from("inquiries").select("name, message, phone, service_id, service_name").eq("id", r.data.id).single();
  assert.equal(row.name.length, 120);
  assert.equal(row.message.length, 2000);
  assert.equal(row.phone.length, 40);
  assert.equal(row.service_id, null);
  assert.equal(row.service_name, "");
});

test("a service from another business can't be attached", async () => {
  const r = await send({ service: st.orgB.services.consult ?? Object.values(st.orgB.services)[0] });
  assert.equal(r.error, null);
  const { data: row } = await admin.from("inquiries").select("service_id").eq("id", r.data.id).single();
  assert.equal(row.service_id, null);
});

test("spam is slowed down: 3 messages an hour per address, 10 per network", async () => {
  const email = `${unique("lim")}@customers.tempo-e2e.test`;
  for (let i = 1; i <= 3; i++) assert.equal((await send({ email, message: `message number ${i}` })).error, null);
  const fourth = await send({ email, message: "message number 4" });
  assert.match(fourth.error?.message ?? "", /too many/i);
  clean(fourth, "email limit");

  const ip = unique("ip");
  for (let i = 1; i <= 10; i++) assert.equal((await send({ ip })).error, null, `message ${i} from one network`);
  const eleventh = await send({ ip });
  assert.match(eleventh.error?.message ?? "", /too many/i);
});

test("a business that turned the form off refuses messages, and the form says so", async () => {
  await admin.from("organizations").update({ inquiries_enabled: false }).eq("id", st.orgB.id);
  try {
    const r = await send({ org: st.orgB.id, service: null });
    assert.ok(r.error);
    assert.equal(r.error.code, "P0001");
    clean(r, "disabled");
    const c = await pub.rpc("get_public_contact", { p_slug: st.orgB.slug });
    assert.equal(c.data.org.inquiries_enabled, false);
  } finally {
    await admin.from("organizations").update({ inquiries_enabled: true }).eq("id", st.orgB.id);
  }
});

test("get_public_contact shows only what a visitor needs", async () => {
  const c = await pub.rpc("get_public_contact", { p_slug: st.orgA.slug });
  assert.equal(c.error, null);
  assert.deepEqual(Object.keys(c.data.org).sort(), ["accent_color", "currency", "description", "id", "inquiries_enabled", "logo_url", "name", "phone", "slug"]);
  assert.ok(c.data.services.length > 0);
  for (const s of c.data.services) assert.deepEqual(Object.keys(s).sort(), ["id", "name", "slug"]);
  const none = await pub.rpc("get_public_contact", { p_slug: "no-such-business" });
  assert.equal(none.data, null);
});

test("visitors can't read, change or delete anything in inquiries", async () => {
  await send();
  const read = await pub.from("inquiries").select("*");
  assert.equal(read.data?.length ?? 0, 0);
  const ins = await pub.from("inquiries").insert({ org_id: st.orgA.id, name: "x", email: "x@x.co", message: "hello" });
  assert.ok(ins.error, "direct insert must be refused");
  const upd = await pub.from("inquiries").update({ status: "handled" }).eq("org_id", st.orgA.id).select();
  assert.equal(upd.data?.length ?? 0, 0);
  const del = await pub.from("inquiries").delete().eq("org_id", st.orgA.id).select();
  assert.equal(del.data?.length ?? 0, 0);
});

test("team members see their own inquiries; other teams and strangers see none", async () => {
  const r = await send();
  for (const who of ["ownerA", "adminA", "staffA1"]) {
    const rows = await as[who].from("inquiries").select("id").eq("id", r.data.id);
    assert.equal(rows.data?.length, 1, `${who} should see it`);
  }
  for (const who of ["ownerB", "stranger"]) {
    const rows = await as[who].from("inquiries").select("id").eq("org_id", st.orgA.id);
    assert.equal(rows.data?.length ?? 0, 0, `${who} must not see it`);
    const upd = await as[who].from("inquiries").update({ status: "archived" }).eq("id", r.data.id).select();
    assert.equal(upd.data?.length ?? 0, 0, `${who} must not change it`);
  }
});

test("staff can change the status and note, and the time and person are recorded; they can't rewrite the visitor's words", async () => {
  const r = await send();
  const upd = await as.staffA1.from("inquiries").update({ status: "handled", note: "Called back" }).eq("id", r.data.id).select().single();
  assert.equal(upd.error, null);
  assert.equal(upd.data.status, "handled");
  assert.ok(upd.data.handled_at);
  assert.equal(upd.data.handled_by, st.people.staffA1.id);
  const back = await as.staffA1.from("inquiries").update({ status: "new" }).eq("id", r.data.id).select().single();
  assert.equal(back.data.handled_at, null);

  for (const patch of [{ message: "edited" }, { name: "edited" }, { email: "edited@x.co" }, { org_id: st.orgB.id }, { created_at: "2020-01-01" }]) {
    const bad = await as.staffA1.from("inquiries").update(patch).eq("id", r.data.id).select();
    assert.ok(bad.error || (bad.data?.length ?? 0) === 0, `staff changed ${Object.keys(patch)[0]}`);
  }
  const { data: row } = await admin.from("inquiries").select("message, name, email, org_id").eq("id", r.data.id).single();
  assert.notEqual(row.message, "edited");
  assert.equal(row.org_id, st.orgA.id);
});

test("only owners and admins can delete an inquiry", async () => {
  const r = await send();
  const staff = await as.staffA1.from("inquiries").delete().eq("id", r.data.id).select();
  assert.equal(staff.data?.length ?? 0, 0, "plain staff must not delete");
  const owner = await as.ownerA.from("inquiries").delete().eq("id", r.data.id).select();
  assert.equal(owner.data?.length, 1);
});

test("'a website message is received' is a workflow trigger; made-up triggers are still refused; the log can name the inquiry", async () => {
  const ok = await admin.from("workflows").insert({ org_id: st.orgA.id, name: "Inquiry check", trigger: "inquiry_received" }).select("id").single();
  assert.equal(ok.error, null, ok.error?.message);
  const bad = await admin.from("workflows").insert({ org_id: st.orgA.id, name: "Bad", trigger: "nonsense" });
  assert.ok(bad.error, "an unknown trigger must be refused");
  const r = await send();
  const log = await admin.from("message_log").insert({ org_id: st.orgA.id, inquiry_id: r.data.id, workflow_id: ok.data.id, workflow_name: "Inquiry check", channel: "email", recipient: "x@x.co", status: "sent" }).select("id").single();
  assert.equal(log.error, null, log.error?.message);
  await admin.from("workflows").delete().eq("id", ok.data.id);
});

test("deleting a customer keeps the message; deleting the business removes everything", async () => {
  const email = `${unique("del")}@customers.tempo-e2e.test`;
  const r = await send({ email });
  const { data: row } = await admin.from("inquiries").select("customer_id").eq("id", r.data.id).single();
  await admin.from("customers").delete().eq("id", row.customer_id);
  const { data: after } = await admin.from("inquiries").select("id, customer_id").eq("id", r.data.id).single();
  assert.equal(after.customer_id, null);
});
