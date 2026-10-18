// Several spots in one class booking: capacity counts spots, totals are right, and nothing goes over.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, pub, signedIn, st, TECHNICAL, unique, weekday } from "./util.mjs";

const as = {};
let svcId;
let day = 0;
const SARA = () => st.orgA.members.sara;
const email = (p = "sp") => `${unique(p)}@customers.tempo-e2e.test`;

before(async () => {
  as.ownerA = await signedIn(st.people.ownerA.email, st.people.ownerA.password);
  const { data, error } = await admin.from("services").insert({ org_id: st.orgA.id, name: "Spots Class", slug: "spots-class", duration_minutes: 60, price_cents: 2000, is_class: true, class_capacity: 4, position: 88 }).select("id").single();
  assert.equal(error, null, error?.message);
  svcId = data.id;
});
after(async () => {
  await admin.from("bookings").delete().eq("service_id", svcId);
  await admin.from("class_sessions").delete().eq("service_id", svcId);
  await admin.from("services").delete().eq("id", svcId);
});

async function makeSession(o = {}) {
  const key = weekday(`spots${++day}`);
  const startsAt = at(key, o.time ?? "10:00");
  const ends = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
  const { data, error } = await admin.from("class_sessions").insert({ org_id: st.orgA.id, service_id: svcId, member_id: SARA(), location_id: st.orgA.locations.qw, starts_at: startsAt, ends_at: ends, blocked_until: ends, capacity: o.capacity ?? 4 }).select("*").single();
  assert.equal(error, null, error?.message);
  return data;
}
const join = (s, o = {}) =>
  pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: s.id, p_name: o.name ?? "Spot Taker", p_email: o.email ?? email(), p_phone: "", p_notes: "", ...(o.spots === undefined ? {} : { p_spots: o.spots }), ...(o.guests === undefined ? {} : { p_guests: o.guests }) });
const taken = async (s) => (await admin.from("bookings").select("spots").eq("session_id", s.id).in("status", ["confirmed", "pending_approval", "pending_payment"])).data.reduce((n, b) => n + b.spots, 0);
const worded = (r, what, pattern) => {
  assert.ok(r.error, `${what}: should be refused`);
  assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
  assert.ok(!TECHNICAL.test(r.error.message), `${what}: technical words leaked: ${r.error.message}`);
  if (pattern) assert.match(r.error.message, pattern, what);
};

test("a booking of two spots holds two spots, with the total price and the guest names", async () => {
  const s = await makeSession({});
  const r = await join(s, { spots: 2, guests: "Pat and Lee" });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data.spots, 2);
  const { data: b } = await admin.from("bookings").select("spots, price_cents, deposit_cents, guest_names").eq("id", r.data.id).single();
  assert.deepEqual(b, { spots: 2, price_cents: 4000, deposit_cents: 0, guest_names: "Pat and Lee" });
  assert.equal(await taken(s), 2);
  const from = new Date(new Date(s.starts_at).getTime() - 86_400_000).toISOString();
  const to = new Date(new Date(s.starts_at).getTime() + 86_400_000).toISOString();
  const { data: list } = await pub.rpc("get_public_sessions", { p_org: st.orgA.id, p_from: from, p_to: to });
  assert.equal(list.find((x) => x.id === s.id).booked, 2, "the public count is in spots");
});

test("one spot is the default, and guest names are only kept when there are guests", async () => {
  const s = await makeSession({});
  const r = await join(s, { guests: "should not be kept" });
  assert.equal(r.data.spots, 1);
  const one = await join(s, { spots: 1, guests: "nor this" });
  const { data: rows } = await admin.from("bookings").select("spots, guest_names, price_cents").in("id", [r.data.id, one.data.id]);
  for (const b of rows) assert.deepEqual(b, { spots: 1, guest_names: null, price_cents: 2000 });
});

test("more spots than are left, none, or too many at once are refused in plain words", async () => {
  const s = await makeSession({ capacity: 4 });
  assert.equal((await join(s, { spots: 3 })).error, null);
  worded(await join(s, { spots: 2 }), "two when one is left", /Only 1 spot is left/);
  worded(await join(s, { spots: 0 }), "zero spots", /1 to 6/);
  worded(await join(s, { spots: 7 }), "seven spots", /1 to 6/);
  assert.equal((await join(s, { spots: 1 })).error, null);
  worded(await join(s), "full", /full/i);
  assert.equal(await taken(s), 4);
});

test("people racing with groups never go over capacity", async () => {
  const s = await makeSession({ capacity: 4 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => join(s, { spots: 2, name: `Group ${i}` })));
  assert.equal(results.filter((r) => !r.error).length, 2, "exactly two groups of two fit");
  for (const r of results.filter((x) => x.error)) worded(r, "race loser");
  assert.equal(await taken(s), 4);
  // a mix of sizes
  const s2 = await makeSession({ capacity: 5 });
  const mix = await Promise.all([3, 3, 2, 2, 1, 1].map((n, i) => join(s2, { spots: n, name: `Mix ${i}` })));
  assert.ok((await taken(s2)) <= 5, "never over");
  assert.ok(mix.some((r) => !r.error));
});

test("cancelling a booking frees every one of its spots", async () => {
  const s = await makeSession({ capacity: 4 });
  const r = await join(s, { spots: 3 });
  await join(s, { spots: 1 });
  worded(await join(s, { spots: 1 }), "full");
  const c = await pub.rpc("cancel_booking_by_token", { p_token: r.data.manage_token, p_reason: "" });
  assert.equal(c.error, null, c.error?.message);
  assert.equal(await taken(s), 1);
  assert.equal((await join(s, { spots: 3 })).error, null);
});

test("the team can't push a booking past capacity either, directly or by adding spots", async () => {
  const s = await makeSession({ capacity: 4 });
  const a = await join(s, { spots: 2 });
  await join(s, { spots: 1 });
  const grow = await admin.from("bookings").update({ spots: 4, price_cents: 8000 }).eq("id", a.data.id);
  assert.ok(grow.error, "growing a booking past capacity is refused");
  assert.match(grow.error.message, /Only 3 spots are left/); // the booking can use up to 3 (its own two plus the one that is free)
  const ok = await admin.from("bookings").update({ spots: 3, price_cents: 6000 }).eq("id", a.data.id);
  assert.equal(ok.error, null, ok.error?.message);
  const shrink = await admin.from("bookings").update({ spots: 1, price_cents: 2000 }).eq("id", a.data.id);
  assert.equal(shrink.error, null, shrink.error?.message);
  const { data: cust } = await admin.from("customers").insert({ org_id: st.orgA.id, name: "Walk In", email: email("walk") }).select("id").single();
  const over = await admin.from("bookings").insert({ org_id: st.orgA.id, session_id: s.id, customer_id: cust.id, status: "confirmed", service_name: "Spots Class", member_id: SARA(), starts_at: s.starts_at, ends_at: s.ends_at, blocked_until: s.blocked_until, spots: 3 });
  assert.ok(over.error, "a walk-in group that doesn't fit is refused");
  assert.match(over.error.message, /Only 2 spots are left/);
});

test("moving a group needs room for all of them", async () => {
  const from = await makeSession({ capacity: 6 });
  const tight = await makeSession({ capacity: 4 });
  const roomy = await makeSession({ capacity: 4 });
  const g = await join(from, { spots: 3 });
  await join(tight, { spots: 2 });
  const no = await as.ownerA.rpc("move_class_booking", { p_booking: g.data.id, p_session: tight.id });
  worded(no, "a group into a session with two left", /full/i);
  const yes = await as.ownerA.rpc("move_class_booking", { p_booking: g.data.id, p_session: roomy.id });
  assert.equal(yes.error, null, yes.error?.message);
  assert.equal(await taken(from), 0);
  assert.equal(await taken(roomy), 3);
});

test("a deposit is charged for every spot, and an unpaid hold frees all of them", async () => {
  await admin.from("services").update({ deposit_cents: 500 }).eq("id", svcId);
  await admin.from("organizations").update({ stripe_charges_enabled: true }).eq("id", st.orgA.id);
  try {
    const s = await makeSession({ capacity: 3 });
    const r = await join(s, { spots: 2 });
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.data.status, "pending_payment");
    const { data: b } = await admin.from("bookings").select("price_cents, deposit_cents").eq("id", r.data.id).single();
    assert.deepEqual(b, { price_cents: 4000, deposit_cents: 1000 });
    worded(await join(s, { spots: 2 }), "the held spots count", /Only 1 spot is left/);
    await admin.from("bookings").update({ created_at: new Date(Date.now() - 40 * 60_000).toISOString() }).eq("id", r.data.id);
    assert.equal((await join(s, { spots: 3 })).error, null, "the lapsed hold's two spots are free again");
  } finally {
    await admin.from("organizations").update({ stripe_charges_enabled: false }).eq("id", st.orgA.id);
    await admin.from("services").update({ deposit_cents: 0 }).eq("id", svcId);
  }
});

test("the manage page's data shows the booking's own spots and guests, and nobody else's", async () => {
  const s = await makeSession({});
  const mine = await join(s, { spots: 2, guests: "Dana", name: "Me Myself" });
  await join(s, { spots: 1, name: "Somebody Else" });
  const { data } = await pub.rpc("get_booking_by_token", { p_token: mine.data.manage_token });
  assert.equal(data.spots, 2);
  assert.equal(data.guest_names, "Dana");
  assert.ok(!JSON.stringify(data).includes("Somebody Else"));
});
