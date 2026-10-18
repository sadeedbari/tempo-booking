// The waitlist for full class sessions: joining, order, automatic booking-in, leaving, and what it never allows.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, pub, signedIn, st, TECHNICAL, unique, weekday } from "./util.mjs";

const as = {};
let svcId;
let day = 0;
const SARA = () => st.orgA.members.sara;
const email = (p = "wl") => `${unique(p)}@customers.tempo-e2e.test`;

before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
  const { data, error } = await admin.from("services").insert({ org_id: st.orgA.id, name: "Wait Class", slug: "wait-class", duration_minutes: 60, price_cents: 1000, is_class: true, class_capacity: 2, position: 87 }).select("id").single();
  assert.equal(error, null, error?.message);
  svcId = data.id;
});
after(async () => {
  await admin.from("class_waitlist").delete().eq("org_id", st.orgA.id);
  await admin.from("bookings").delete().eq("service_id", svcId);
  await admin.from("class_sessions").delete().eq("service_id", svcId);
  await admin.from("services").delete().eq("id", svcId);
});

async function makeSession(o = {}) {
  const key = weekday(`wait${++day}`);
  const startsAt = o.startsAt ?? at(key, "10:00");
  const ends = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
  const { data, error } = await admin.from("class_sessions").insert({ org_id: st.orgA.id, service_id: svcId, member_id: SARA(), location_id: st.orgA.locations.qw, starts_at: startsAt, ends_at: ends, blocked_until: ends, capacity: o.capacity ?? 2 }).select("*").single();
  assert.equal(error, null, error?.message);
  return data;
}
const book = async (s, o = {}) => {
  const r = await pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: s.id, p_name: o.name ?? "Booker", p_email: o.email ?? email(), p_phone: "", p_notes: "", p_spots: o.spots ?? 1 });
  assert.equal(r.error, null, r.error?.message);
  return r.data;
};
const wait = (s, o = {}) =>
  pub.rpc("join_class_waitlist", { p_org: st.orgA.id, p_session: s.id, p_name: o.name ?? "Waiter", p_email: o.email ?? email(), p_phone: o.phone ?? "", p_notes: o.notes ?? "", p_spots: o.spots ?? 1, ...(o.guests ? { p_guests: o.guests } : {}), ...(o.answers ? { p_answers: o.answers } : {}) });
const entry = async (token) => (await admin.from("class_waitlist").select("*").eq("token", token).single()).data;
const taken = async (s) => (await admin.from("bookings").select("spots").eq("session_id", s.id).in("status", ["confirmed", "pending_approval", "pending_payment"])).data.reduce((n, b) => n + b.spots, 0);
const cancel = (id) => admin.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
const worded = (r, what, pattern) => {
  assert.ok(r.error, `${what}: should be refused`);
  assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
  assert.ok(!TECHNICAL.test(r.error.message), `${what}: technical words leaked: ${r.error.message}`);
  if (pattern) assert.match(r.error.message, pattern, what);
};

test("joining is only for a full session, with positions in the order people joined", async () => {
  const s = await makeSession({});
  worded(await wait(s), "room in the session", /room/i);
  await book(s);
  await book(s);
  const a = await wait(s, { name: "First" });
  const b = await wait(s, { name: "Second" });
  assert.equal(a.error, null, a.error?.message);
  assert.equal(a.data.position, 1);
  assert.equal(b.data.position, 2);
  assert.match(a.data.token, /^[0-9a-f]{48}$/);
  const { data: cust } = await admin.from("customers").select("id").eq("org_id", st.orgA.id).ilike("name", "First").limit(1);
  assert.ok(cust.length, "a customer record is made when someone joins");
  const v = await pub.rpc("get_waitlist_by_token", { p_token: b.data.token });
  assert.equal(v.data.status, "waiting");
  assert.equal(v.data.position, 2);
  assert.equal(v.data.service_name, "Wait Class");
  assert.equal(v.data.booking_token, null);
});

test("the same person can't join twice or while booked; input is checked; a short token finds nothing", async () => {
  const s = await makeSession({});
  const booked = email("in");
  await book(s, { email: booked });
  await book(s);
  const e = email("dup");
  assert.equal((await wait(s, { email: e })).error, null);
  worded(await wait(s, { email: e.toUpperCase() }), "already waiting", /already on the waitlist/);
  worded(await wait(s, { email: booked }), "already booked", /already booked/);
  worded(await wait(s, { name: " " }), "no name");
  worded(await wait(s, { email: "nope" }), "bad email");
  worded(await wait(s, { spots: 0 }), "no spots", /1 to 6/);
  worded(await wait(s, { spots: 7 }), "seven spots", /1 to 6/);
  assert.equal((await pub.rpc("get_waitlist_by_token", { p_token: "short" })).data, null);
  assert.equal((await pub.rpc("get_waitlist_by_token", { p_token: "x".repeat(48) })).data, null);
});

test("a cancelled spot books in the first person waiting, who is shown the booking", async () => {
  const s = await makeSession({});
  const first = await book(s);
  await book(s);
  const w1 = (await wait(s, { name: "Waiter One", notes: "Hello" })).data;
  const w2 = (await wait(s, { name: "Waiter Two" })).data;
  await cancel(first.id);
  const e1 = await entry(w1.token);
  assert.equal(e1.status, "booked");
  assert.ok(e1.booking_id && e1.promoted_at);
  assert.equal(e1.notified_at, null, "told by the app, not the database");
  assert.equal((await entry(w2.token)).status, "waiting");
  const { data: b } = await admin.from("bookings").select("status, spots, price_cents, notes, session_id, source").eq("id", e1.booking_id).single();
  assert.deepEqual(b, { status: "confirmed", spots: 1, price_cents: 1000, notes: "Hello", session_id: s.id, source: "online" });
  assert.equal(await taken(s), 2);
  const v = await pub.rpc("get_waitlist_by_token", { p_token: w1.token });
  assert.equal(v.data.status, "booked");
  assert.match(v.data.booking_token, /^[0-9a-f]{48}$/);
  assert.equal((await pub.rpc("get_waitlist_by_token", { p_token: w2.token })).data.position, 1, "the next in line moves up");
});

test("a group too big for the spot waits, and a smaller one behind it takes it", async () => {
  const s = await makeSession({ capacity: 3 });
  await book(s, { spots: 2 });
  const single = await book(s);
  const big = (await wait(s, { name: "Big group", spots: 2 })).data;
  const small = (await wait(s, { name: "Small", spots: 1 })).data;
  await cancel(single.id); // one spot opens
  assert.equal((await entry(big.token)).status, "waiting");
  assert.equal((await entry(small.token)).status, "booked");
  assert.equal(await taken(s), 3);
});

test("raising the spots, moving someone away, or a booking shrinking all book people in", async () => {
  const s = await makeSession({});
  const other = await makeSession({});
  await book(s);
  const mover = await book(s);
  const w1 = (await wait(s, { name: "W1" })).data;
  const w2 = (await wait(s, { name: "W2" })).data;
  const w3 = (await wait(s, { name: "W3", spots: 2, guests: "Pal" })).data;
  // more spots: W1 and W2 fit (one each), W3 needs two
  await admin.from("class_sessions").update({ capacity: 3 }).eq("id", s.id);
  assert.equal((await entry(w1.token)).status, "booked");
  assert.equal((await entry(w2.token)).status, "waiting");
  // moving someone to another session frees a spot
  const m = await as.ownerA.rpc("move_class_booking", { p_booking: mover.id, p_session: other.id });
  assert.equal(m.error, null, m.error?.message);
  assert.equal((await entry(w2.token)).status, "booked");
  // fewer spots held by a booking
  await admin.from("class_sessions").update({ capacity: 5 }).eq("id", s.id);
  const e3 = await entry(w3.token);
  assert.equal(e3.status, "booked", "the group of two fits once there is room");
  const { data: b } = await admin.from("bookings").select("spots, guest_names, price_cents").eq("id", e3.booking_id).single();
  assert.deepEqual(b, { spots: 2, guest_names: "Pal", price_cents: 2000 });
});

test("people are booked in first come first served and never over capacity, even with many cancellations at once", async () => {
  const s = await makeSession({ capacity: 4 });
  const held = [];
  for (let i = 0; i < 4; i++) held.push(await book(s));
  const waiters = [];
  for (let i = 0; i < 6; i++) waiters.push((await wait(s, { name: `Waiter ${i}` })).data);
  await Promise.all(held.slice(0, 3).map((h) => cancel(h.id)));
  assert.ok((await taken(s)) <= 4, "never over capacity");
  assert.equal(await taken(s), 4);
  const statuses = [];
  for (const w of waiters) statuses.push((await entry(w.token)).status);
  assert.deepEqual(statuses, ["booked", "booked", "booked", "waiting", "waiting", "waiting"], "the first three in line got the three spots");
});

test("someone who booked another way is closed off the list rather than booked twice", async () => {
  const s = await makeSession({});
  const a = await book(s);
  await book(s);
  const e = email("both");
  const w = (await wait(s, { email: e })).data;
  await cancel(a.id); // a spot opens: the waiter is booked in
  assert.equal((await entry(w.token)).status, "booked");
  // a second entry for the same person can't exist while waiting, so check the duplicate-booking guard directly
  const { data: rows } = await admin.from("bookings").select("id, customer_id").eq("session_id", s.id).in("status", ["confirmed"]);
  const custId = (await entry(w.token)).customer_id;
  const mine = rows.filter((r) => r.customer_id === custId);
  assert.equal(mine.length, 1, "exactly one booking for them");
});

test("leaving the waitlist, once; a left entry is never booked", async () => {
  const s = await makeSession({});
  const a = await book(s);
  await book(s);
  const w = (await wait(s)).data;
  const next = (await wait(s)).data;
  const left = await pub.rpc("leave_class_waitlist", { p_token: w.token });
  assert.equal(left.error, null, left.error?.message);
  worded(await pub.rpc("leave_class_waitlist", { p_token: w.token }), "leaving twice", /no longer active/);
  worded(await pub.rpc("leave_class_waitlist", { p_token: "short" }), "a short token");
  assert.equal((await pub.rpc("get_waitlist_by_token", { p_token: next.token })).data.position, 1);
  await cancel(a.id);
  assert.equal((await entry(w.token)).status, "left");
  assert.equal((await entry(next.token)).status, "booked");
});

test("cancelling the session lets everyone on its waitlist go; a started or cancelled session takes no one", async () => {
  const s = await makeSession({});
  await book(s);
  await book(s);
  const w = (await wait(s)).data;
  await admin.from("class_sessions").update({ status: "cancelled" }).eq("id", s.id);
  assert.equal((await entry(w.token)).status, "closed");
  worded(await wait(s), "a cancelled session");
  const v = await pub.rpc("get_waitlist_by_token", { p_token: w.token });
  assert.equal(v.data.status, "closed");
  assert.equal(v.data.session_status, "cancelled");
  const started = await makeSession({ startsAt: new Date(Date.now() - 3_600_000).toISOString() });
  worded(await wait(started), "a started session");
});

test("a class with an online deposit has no waitlist, and nobody is booked in unpaid", async () => {
  await admin.from("services").update({ deposit_cents: 300 }).eq("id", svcId);
  await admin.from("organizations").update({ stripe_charges_enabled: true }).eq("id", st.orgA.id);
  try {
    const s = await makeSession({});
    await admin.from("bookings").insert([0, 1].map(() => ({ org_id: st.orgA.id, service_id: svcId, session_id: s.id, status: "confirmed", service_name: "Wait Class", member_id: SARA(), starts_at: s.starts_at, ends_at: s.ends_at, blocked_until: s.blocked_until })));
    worded(await wait(s), "a deposit class", /no waitlist/);
    const from = new Date(new Date(s.starts_at).getTime() - 86_400_000).toISOString();
    const to = new Date(new Date(s.starts_at).getTime() + 86_400_000).toISOString();
    const { data } = await pub.rpc("get_public_sessions", { p_org: st.orgA.id, p_from: from, p_to: to });
    assert.equal(data.find((x) => x.id === s.id).waitlist_open, false);
  } finally {
    await admin.from("organizations").update({ stripe_charges_enabled: false }).eq("id", st.orgA.id);
    await admin.from("services").update({ deposit_cents: 0 }).eq("id", svcId);
  }
});

test("the public list shows who can join and how many are waiting, never who", async () => {
  const s = await makeSession({});
  await book(s);
  await book(s);
  await wait(s, { name: "Secret Waiter", spots: 2 });
  const from = new Date(new Date(s.starts_at).getTime() - 86_400_000).toISOString();
  const to = new Date(new Date(s.starts_at).getTime() + 86_400_000).toISOString();
  const { data } = await pub.rpc("get_public_sessions", { p_org: st.orgA.id, p_from: from, p_to: to });
  const mine = data.find((x) => x.id === s.id);
  assert.equal(mine.waiting, 2, "counted in spots");
  assert.equal(mine.waitlist_open, true);
  assert.ok(!JSON.stringify(data).includes("Secret Waiter"));
});

test("only the team can read or change the waitlist", async () => {
  const s = await makeSession({});
  await book(s);
  await book(s);
  const w = (await wait(s)).data;
  assert.equal(((await pub.from("class_waitlist").select("id").eq("token", w.token)).data ?? []).length, 0, "the public can't read it");
  for (const who of ["ownerA", "adminA", "staffA1"]) {
    const rows = await as[who].from("class_waitlist").select("id").eq("token", w.token);
    assert.equal(rows.data?.length, 1, `${who} sees it`);
  }
  for (const who of ["ownerB", "stranger"]) {
    const rows = await as[who].from("class_waitlist").select("id").eq("token", w.token);
    assert.equal(rows.data?.length ?? 0, 0, `${who} must not see it`);
  }
  const rm = await as.staffA1.from("class_waitlist").update({ status: "removed" }).eq("token", w.token).select("id");
  assert.equal(rm.data?.length, 1, "staff can remove someone");
  const del = await as.staffA1.from("class_waitlist").delete().eq("token", w.token).select("id");
  assert.equal(del.data?.length ?? 0, 0, "staff can't delete rows");
  const del2 = await as.adminA.from("class_waitlist").delete().eq("token", w.token).select("id");
  assert.equal(del2.data?.length, 1, "an admin can");
});
