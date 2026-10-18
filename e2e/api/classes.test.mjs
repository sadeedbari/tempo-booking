// Group classes: sessions with a capacity, booking a spot, and how sessions share the instructor's time.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, book, pub, signedIn, st, TECHNICAL, unique, weekday } from "./util.mjs";

const as = {};
let svcId;
let day = 0;
const SARA = () => st.orgA.members.sara;
const email = (p = "cls") => `${unique(p)}@customers.tempo-e2e.test`;

before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
  const { data, error } = await admin.from("services").insert({ org_id: st.orgA.id, name: "Class Test", slug: "class-test", duration_minutes: 60, price_cents: 2500, is_class: true, class_capacity: 3, position: 97 }).select("id").single();
  assert.equal(error, null, error?.message);
  svcId = data.id;
});
after(async () => {
  await admin.from("bookings").delete().eq("service_id", svcId);
  await admin.from("class_sessions").delete().eq("service_id", svcId);
  await admin.from("services").delete().eq("id", svcId);
});

/** A session on its own day (so tests never share an instructor's time), through the admin connection. */
async function makeSession(o = {}) {
  const key = weekday(`class${++day}`);
  const startsAt = o.startsAt ?? at(key, o.time ?? "10:00");
  const ends = new Date(new Date(startsAt).getTime() + (o.minutes ?? 60) * 60_000).toISOString();
  const { data, error } = await admin
    .from("class_sessions")
    .insert({ org_id: st.orgA.id, service_id: o.service ?? svcId, member_id: o.member ?? SARA(), location_id: o.location ?? st.orgA.locations.qw, starts_at: startsAt, ends_at: ends, blocked_until: ends, capacity: o.capacity ?? 3, notes: o.notes ?? null, status: o.status ?? "scheduled" })
    .select("*")
    .single();
  if (o.expectError) return { error };
  assert.equal(error, null, error?.message);
  return data;
}
const join = (s, o = {}) =>
  pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: s.id ?? s, p_name: o.name ?? "Class Goer", p_email: o.email ?? email(), p_phone: "", p_notes: o.notes ?? "", ...(o.answers === undefined ? {} : { p_answers: o.answers }) });
const worded = (r, what) => {
  assert.ok(r.error, `${what}: should be refused`);
  assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
  assert.ok(!TECHNICAL.test(r.error.message), `${what}: technical words leaked: ${r.error.message}`);
};
const spots = async (s) => (await admin.from("bookings").select("id").eq("session_id", s.id).in("status", ["confirmed", "pending_approval", "pending_payment"])).data.length;

test("booking a spot: one booking per person, taking the session's time and instructor", async () => {
  const s = await makeSession({ capacity: 5 });
  const e = email("first");
  const r = await join(s, { email: e, name: "Yasmin Yoga", notes: "first time" });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data.status, "confirmed");
  assert.equal(r.data.session_id, s.id);
  assert.equal(r.data.member_id, SARA());
  const { data: b } = await admin.from("bookings").select("*").eq("id", r.data.id).single();
  assert.equal(b.session_id, s.id);
  assert.equal(new Date(b.starts_at).toISOString(), new Date(s.starts_at).toISOString());
  assert.equal(new Date(b.ends_at).toISOString(), new Date(s.ends_at).toISOString());
  assert.equal(b.service_id, svcId);
  assert.equal(b.service_name, "Class Test");
  assert.equal(b.price_cents, 2500);
  assert.equal(b.source, "online");
  assert.equal(b.notes, "first time");
  const { data: c } = await admin.from("customers").select("name, email").eq("id", b.customer_id).single();
  assert.deepEqual(c, { name: "Yasmin Yoga", email: e });
});

test("a class fills up: the last spot is the last, and a full class says so in plain words", async () => {
  const s = await makeSession({ capacity: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await join(s)).error, null);
  worded(await join(s), "fourth person");
  assert.equal(await spots(s), 3);
});

test("people racing for the last spots never go over capacity", async () => {
  const s = await makeSession({ capacity: 2 });
  const results = await Promise.all(Array.from({ length: 8 }, () => join(s)));
  const wins = results.filter((r) => !r.error);
  assert.equal(wins.length, 2, `exactly two win (got ${wins.length})`);
  for (const r of results.filter((x) => x.error)) worded(r, "race loser");
  assert.equal(await spots(s), 2);
});

test("the same person can't take two spots in one session; another session is fine", async () => {
  const s = await makeSession({});
  const s2 = await makeSession({});
  const e = email("dup");
  assert.equal((await join(s, { email: e })).error, null);
  worded(await join(s, { email: e.toUpperCase() }), "same email again");
  assert.equal((await join(s2, { email: e })).error, null);
});

test("cancelling a spot frees it, and the cancelled person can book again", async () => {
  const s = await makeSession({ capacity: 1 });
  const e = email("cancel");
  const r = await join(s, { email: e });
  worded(await join(s), "full");
  const c = await pub.rpc("cancel_booking_by_token", { p_token: r.data.manage_token, p_reason: "can't make it" });
  assert.equal(c.error, null, c.error?.message);
  assert.equal(await spots(s), 0);
  assert.equal((await join(s, { email: e })).error, null);
});

test("customers see how many spots are taken, never who", async () => {
  const s = await makeSession({ capacity: 4, notes: "Bring a mat" });
  await join(s, { name: "Secret Person" });
  await join(s);
  const from = new Date(new Date(s.starts_at).getTime() - 86_400_000).toISOString();
  const to = new Date(new Date(s.starts_at).getTime() + 86_400_000).toISOString();
  const { data, error } = await pub.rpc("get_public_sessions", { p_org: st.orgA.id, p_from: from, p_to: to });
  assert.equal(error, null, error?.message);
  const mine = data.find((x) => x.id === s.id);
  assert.ok(mine);
  assert.equal(mine.booked, 2);
  assert.equal(mine.capacity, 4);
  assert.equal(mine.notes, "Bring a mat");
  assert.deepEqual(Object.keys(mine).sort(), ["booked", "capacity", "ends_at", "id", "location_id", "member_id", "notes", "service_id", "starts_at", "waiting", "waitlist_open"]);
  assert.ok(!JSON.stringify(data).includes("Secret Person"));
  // a window longer than four months is refused (empty), and other businesses' sessions never appear
  const wide = await pub.rpc("get_public_sessions", { p_org: st.orgA.id, p_from: from, p_to: new Date(Date.now() + 400 * 86_400_000).toISOString() });
  assert.equal(wide.data.length, 0);
  const other = await pub.rpc("get_public_sessions", { p_org: st.orgB.id, p_from: from, p_to: to });
  assert.equal(other.data.length, 0);
});

test("a cancelled, started or hidden-service session can't be booked or listed", async () => {
  const cancelled = await makeSession({ status: "cancelled" });
  worded(await join(cancelled), "cancelled session");
  // started: a session that began an hour ago
  const past = await makeSession({ startsAt: new Date(Date.now() - 3_600_000).toISOString() });
  worded(await join(past), "started session");
  // service switched off
  const s = await makeSession({});
  await admin.from("services").update({ active: false }).eq("id", svcId);
  try {
    worded(await join(s), "service inactive");
    const from = new Date(new Date(s.starts_at).getTime() - 86_400_000).toISOString();
    const to = new Date(new Date(s.starts_at).getTime() + 86_400_000).toISOString();
    const { data } = await pub.rpc("get_public_sessions", { p_org: st.orgA.id, p_from: from, p_to: to });
    assert.ok(!data.some((x) => x.id === s.id), "hidden service's sessions aren't listed");
  } finally {
    await admin.from("services").update({ active: true }).eq("id", svcId);
  }
  // far beyond how far ahead people may book
  const { data: org } = await admin.from("organizations").select("max_advance_days").eq("id", st.orgA.id).single();
  const far = await makeSession({ startsAt: new Date(Date.now() + (org.max_advance_days + 10) * 86_400_000).toISOString() });
  worded(await join(far), "too far ahead");
});

test("input checks: name, email, and a session from another business", async () => {
  const s = await makeSession({});
  worded(await join(s, { name: " " }), "no name");
  worded(await join(s, { email: "nope" }), "bad email");
  const r = await pub.rpc("create_public_session_booking", { p_org: st.orgB.id, p_session: s.id, p_name: "X", p_email: email(), p_phone: "", p_notes: "" });
  worded(r, "session of another business");
  worded(await pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: "00000000-0000-0000-0000-000000000000", p_name: "X", p_email: email(), p_phone: "", p_notes: "" }), "unknown session");
});

test("a session holds the instructor's time: no overlapping sessions", async () => {
  const s = await makeSession({ time: "13:00" });
  const key = new Date(s.starts_at);
  const overlapping = await makeSession({ startsAt: new Date(key.getTime() + 30 * 60_000).toISOString(), expectError: true });
  assert.ok(overlapping.error, "an overlapping session is refused");
  // back to back is fine
  const next = await makeSession({ startsAt: new Date(key.getTime() + 60 * 60_000).toISOString(), expectError: true });
  assert.equal(next.error, null, next.error?.message);
  // another instructor at the same time is fine
  const sam = await makeSession({ startsAt: s.starts_at, member: st.orgA.members.sam, expectError: true });
  assert.equal(sam.error, null, sam.error?.message);
});

test("one-on-one bookings and sessions can't overlap for the same person, either way round", async () => {
  // a class, then a one-on-one booking on top of it
  const s = await makeSession({ time: "11:00" });
  const key = weekday(`class${day}`);
  const clash = await book({ at: at(key, "11:15") });
  worded(clash, "booking over a class");
  const busy = await pub.rpc("get_public_busy", { p_org: st.orgA.id, p_from: new Date(new Date(s.starts_at).getTime() - 3_600_000).toISOString(), p_to: new Date(new Date(s.starts_at).getTime() + 7_200_000).toISOString() });
  assert.ok(busy.data.some((b) => b.member_id === SARA() && new Date(b.starts_at).getTime() === new Date(s.starts_at).getTime()), "the class shows as busy time");
  // the direct write path (the team's own booking form) is stopped too
  const direct = await admin.from("bookings").insert({ org_id: st.orgA.id, service_id: st.orgA.services.haircut, member_id: SARA(), starts_at: at(key, "11:15"), ends_at: at(key, "11:45"), blocked_until: at(key, "11:45"), status: "confirmed", service_name: "Haircut" });
  assert.ok(direct.error, "a direct booking over a class is refused");
  // a one-on-one booking, then a session over it
  const key2 = weekday(`class${++day}`);
  const one = await book({ at: at(key2, "14:00") });
  assert.equal(one.error, null, one.error?.message);
  const over = await makeSession({ startsAt: at(key2, "13:30"), minutes: 60, expectError: true });
  assert.ok(over.error, "a session over a booking is refused");
  // before and after it is fine
  const ok = await makeSession({ startsAt: at(key2, "15:00"), expectError: true });
  assert.equal(ok.error, null, ok.error?.message);
  await admin.from("bookings").delete().eq("id", one.data.id);
});

test("class services are booked by session; a class spot can't be moved or rescheduled", async () => {
  const s = await makeSession({});
  const key = weekday(`class${day}`);
  worded(await pub.rpc("create_public_booking", { p_org: st.orgA.id, p_service: svcId, p_member: SARA(), p_starts_at: at(key, "16:00"), p_name: "X", p_email: email(), p_phone: "", p_notes: "", p_location: st.orgA.locations.qw, p_address: "" }), "class booked as an appointment");
  const r = await join(s);
  worded(await pub.rpc("reschedule_booking_by_token", { p_token: r.data.manage_token, p_starts_at: at(weekday(`class${++day}`), "10:00") }), "reschedule a class spot");
  const moved = await admin.from("bookings").update({ starts_at: at(key, "12:00") }).eq("id", r.data.id);
  assert.ok(moved.error, "moving a spot directly is refused");
  const view = await pub.rpc("get_booking_by_token", { p_token: r.data.manage_token });
  assert.equal(view.data.session_id, s.id);
});

test("a session can't shrink below who is booked or move once people are in; cancelling is always allowed", async () => {
  const s = await makeSession({ capacity: 4 });
  await join(s);
  await join(s);
  const small = await admin.from("class_sessions").update({ capacity: 1 }).eq("id", s.id);
  assert.ok(small.error, "capacity below the booked count is refused");
  assert.match(small.error.message, /already booked/);
  const fits = await admin.from("class_sessions").update({ capacity: 2 }).eq("id", s.id);
  assert.equal(fits.error, null, fits.error?.message);
  const moved = await admin.from("class_sessions").update({ starts_at: new Date(new Date(s.starts_at).getTime() + 3_600_000).toISOString(), ends_at: new Date(new Date(s.ends_at).getTime() + 3_600_000).toISOString(), blocked_until: new Date(new Date(s.blocked_until).getTime() + 3_600_000).toISOString() }).eq("id", s.id);
  assert.ok(moved.error, "moving a booked session is refused");
  // the team adding a person past capacity is refused by the database, not just the form
  const { data: cust } = await admin.from("customers").insert({ org_id: st.orgA.id, name: "Walk In", email: email("walk") }).select("id").single();
  const over = await admin.from("bookings").insert({ org_id: st.orgA.id, session_id: s.id, customer_id: cust.id, status: "confirmed", service_name: "Class Test", member_id: SARA(), starts_at: s.starts_at, ends_at: s.ends_at, blocked_until: s.blocked_until });
  assert.ok(over.error, "over capacity refused");
  assert.match(over.error.message, /full/i);
  // cancelling the session
  await admin.from("bookings").update({ status: "cancelled" }).eq("session_id", s.id);
  const cancel = await admin.from("class_sessions").update({ status: "cancelled" }).eq("id", s.id);
  assert.equal(cancel.error, null, cancel.error?.message);
  const { data: row } = await admin.from("class_sessions").select("status, cancelled_at").eq("id", s.id).single();
  assert.equal(row.status, "cancelled");
  assert.ok(row.cancelled_at);
  // a cancelled session frees the instructor's time
  const again = await makeSession({ startsAt: s.starts_at, expectError: true });
  assert.equal(again.error, null, again.error?.message);
});

test("a deposit holds the spot for 30 minutes; an unpaid hold is released", async () => {
  await admin.from("services").update({ deposit_cents: 1000 }).eq("id", svcId);
  await admin.from("organizations").update({ stripe_charges_enabled: true }).eq("id", st.orgA.id);
  try {
    const s = await makeSession({ capacity: 1 });
    const r = await join(s);
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.data.status, "pending_payment");
    worded(await join(s), "spot held for payment");
    // 40 minutes later the hold has lapsed
    await admin.from("bookings").update({ created_at: new Date(Date.now() - 40 * 60_000).toISOString() }).eq("id", r.data.id);
    const free = await join(s);
    assert.equal(free.error, null, free.error?.message);
    const { data: old } = await admin.from("bookings").select("status, cancel_reason").eq("id", r.data.id).single();
    assert.equal(old.status, "cancelled");
    assert.equal(old.cancel_reason, "Payment not completed");
  } finally {
    await admin.from("organizations").update({ stripe_charges_enabled: false }).eq("id", st.orgA.id);
    await admin.from("services").update({ deposit_cents: 0 }).eq("id", svcId);
  }
});

test("a class that needs approval books as a request and still holds the spot", async () => {
  await admin.from("services").update({ auto_approve: false }).eq("id", svcId);
  try {
    const s = await makeSession({ capacity: 1 });
    const r = await join(s);
    assert.equal(r.data.status, "pending_approval");
    worded(await join(s), "spot held for approval");
  } finally {
    await admin.from("services").update({ auto_approve: true }).eq("id", svcId);
  }
});

test("intake questions work for classes", async () => {
  const { data: q } = await admin.from("service_questions").insert({ service_id: svcId, org_id: st.orgA.id, label: "Any injuries?", type: "text", options: [], required: true, position: 0 }).select("id").single();
  try {
    const s = await makeSession({});
    worded(await join(s), "required answer missing");
    const ok = await join(s, { answers: { [q.id]: "none" } });
    assert.equal(ok.error, null, ok.error?.message);
    const { data: b } = await admin.from("bookings").select("answers").eq("id", ok.data.id).single();
    assert.ok(JSON.stringify(b.answers).includes("none"));
  } finally {
    await admin.from("service_questions").delete().eq("id", q.id);
  }
});

test("the booking page's data says which services are classes", async () => {
  const { data } = await pub.rpc("get_public_org", { p_slug: st.orgA.slug });
  const mine = data.services.find((x) => x.id === svcId);
  assert.equal(mine.is_class, true);
  assert.equal(mine.class_capacity, 3);
  assert.equal(data.services.find((x) => x.id === st.orgA.services.haircut).is_class, false);
});

test("who can see and change sessions", async () => {
  const s = await makeSession({});
  for (const who of ["ownerA", "adminA", "staffA1"]) {
    const rows = await as[who].from("class_sessions").select("id").eq("id", s.id);
    assert.equal(rows.data?.length, 1, `${who} sees their team's sessions`);
  }
  for (const who of ["ownerB", "stranger"]) {
    const rows = await as[who].from("class_sessions").select("id").eq("id", s.id);
    assert.equal(rows.data?.length ?? 0, 0, `${who} must not see them`);
  }
  assert.equal(((await pub.from("class_sessions").select("id").eq("id", s.id)).data ?? []).length, 0, "the public reads sessions only through the list function");
  // the team can add a session; another business's owner can't add one to this business
  const key = weekday(`class${++day}`);
  const ok = await as.staffA1.from("class_sessions").insert({ org_id: st.orgA.id, service_id: svcId, member_id: SARA(), starts_at: at(key, "10:00"), ends_at: at(key, "11:00"), blocked_until: at(key, "11:00"), capacity: 5 }).select("id").single();
  assert.equal(ok.error, null, ok.error?.message);
  const bad = await as.ownerB.from("class_sessions").insert({ org_id: st.orgA.id, service_id: svcId, member_id: SARA(), starts_at: at(key, "12:00"), ends_at: at(key, "13:00"), blocked_until: at(key, "13:00"), capacity: 5 });
  assert.ok(bad.error, "another business can't add sessions here");
  // a session of this team can't use someone else's service or instructor
  const { data: orgBMembers } = await admin.from("memberships").select("id").eq("org_id", st.orgB.id).limit(1);
  const orgBMember = orgBMembers[0].id;
  const wrong = await admin.from("class_sessions").insert({ org_id: st.orgA.id, service_id: svcId, member_id: orgBMember, starts_at: at(key, "14:00"), ends_at: at(key, "15:00"), blocked_until: at(key, "15:00"), capacity: 5 });
  assert.ok(wrong.error, "an instructor from another business is refused");
  // only admins delete
  const del = await as.staffA1.from("class_sessions").delete().eq("id", s.id).select("id");
  assert.equal(del.data?.length ?? 0, 0, "staff can't delete a session");
  const del2 = await as.adminA.from("class_sessions").delete().eq("id", s.id).select("id");
  assert.equal(del2.data?.length, 1, "an admin can");
});
