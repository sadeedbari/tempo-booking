// Changing classes after people have booked: moving a person, moving a session, and what stays protected.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, book, pub, signedIn, st, TECHNICAL, unique, weekday } from "./util.mjs";

const as = {};
let svcId;
let otherSvcId;
let day = 0;
const SARA = () => st.orgA.members.sara;
const SAM = () => st.orgA.members.sam;
const email = (p = "mv") => `${unique(p)}@customers.tempo-e2e.test`;

before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
  const mk = async (name, slug, position) => {
    const { data, error } = await admin.from("services").insert({ org_id: st.orgA.id, name, slug, duration_minutes: 60, price_cents: 1500, is_class: true, class_capacity: 4, position }).select("id").single();
    assert.equal(error, null, error?.message);
    return data.id;
  };
  svcId = await mk("Change Class", "change-class", 92);
  otherSvcId = await mk("Other Class", "other-class", 91);
});
after(async () => {
  for (const id of [svcId, otherSvcId]) {
    await admin.from("bookings").delete().eq("service_id", id);
    await admin.from("class_sessions").delete().eq("service_id", id);
    await admin.from("services").delete().eq("id", id);
  }
});

async function makeSession(o = {}) {
  const key = weekday(`chg${++day}`);
  const startsAt = o.startsAt ?? at(key, o.time ?? "10:00");
  const ends = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
  const { data, error } = await admin
    .from("class_sessions")
    .insert({ org_id: st.orgA.id, service_id: o.service ?? svcId, member_id: o.member ?? SARA(), location_id: st.orgA.locations.qw, starts_at: startsAt, ends_at: ends, blocked_until: ends, capacity: o.capacity ?? 4, status: o.status ?? "scheduled", series_id: o.series ?? null, series_index: o.index ?? null })
    .select("*")
    .single();
  assert.equal(error, null, error?.message);
  return data;
}
const join = async (s, name = "Mover") => {
  const r = await pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: s.id, p_name: name, p_email: email(), p_phone: "", p_notes: "" });
  assert.equal(r.error, null, r.error?.message);
  return r.data;
};
const taken = async (s) => (await admin.from("bookings").select("id").eq("session_id", s.id).in("status", ["confirmed", "pending_approval", "pending_payment"])).data.length;
const worded = (r, what) => {
  assert.ok(r.error, `${what}: should be refused`);
  assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
  assert.ok(!TECHNICAL.test(r.error.message), `${what}: technical words leaked: ${r.error.message}`);
};
const move = (who, bookingId, sessionId) => as[who].rpc("move_class_booking", { p_booking: bookingId, p_session: sessionId });
const moveSession = (who, sessionId, startsAt, member) => as[who].rpc("move_class_session", { p_session: sessionId, p_starts_at: startsAt, ...(member ? { p_member: member } : {}) });

test("moving a person takes them to the other session's time and instructor, and frees their old spot", async () => {
  const a = await makeSession({ capacity: 2 });
  const b = await makeSession({ capacity: 2, member: SAM() });
  const r = await join(a);
  await admin.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", r.id);
  assert.equal(await taken(a), 1);
  const m = await move("ownerA", r.id, b.id);
  assert.equal(m.error, null, m.error?.message);
  assert.equal(m.data.from_session, a.id);
  assert.equal(m.data.to_session, b.id);
  const { data: row } = await admin.from("bookings").select("session_id, member_id, starts_at, ends_at, blocked_until, status, reminder_sent_at").eq("id", r.id).single();
  assert.equal(row.session_id, b.id);
  assert.equal(row.member_id, SAM());
  assert.equal(new Date(row.starts_at).getTime(), new Date(b.starts_at).getTime());
  assert.equal(new Date(row.ends_at).getTime(), new Date(b.ends_at).getTime());
  assert.equal(row.status, "confirmed");
  assert.equal(row.reminder_sent_at, null, "a fresh reminder for the new time");
  assert.equal(await taken(a), 0);
  assert.equal(await taken(b), 1);
  // the flag didn't stay on: a plain move of the spot is refused again
  const plain = await admin.from("bookings").update({ starts_at: at(weekday("chg-plain"), "09:00") }).eq("id", r.id);
  assert.ok(plain.error, "a direct change of a class spot is still refused");
});

test("a full session, the same session, the same person twice, another class, a started or cancelled session are all refused", async () => {
  const a = await makeSession({ capacity: 4 });
  const full = await makeSession({ capacity: 1 });
  await join(full);
  const r = await join(a);
  worded(await move("ownerA", r.id, full.id), "full session");
  worded(await move("ownerA", r.id, a.id), "same session");
  // the same person already in the target
  const e = email("twice");
  const s2 = await makeSession({});
  const pair = [];
  for (const s of [a, s2]) {
    const x = await pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: s.id, p_name: "Twice", p_email: e, p_phone: "", p_notes: "" });
    assert.equal(x.error, null, x.error?.message);
    pair.push(x.data);
  }
  worded(await move("ownerA", pair[0].id, s2.id), "person already in the target");
  // another class
  const other = await makeSession({ service: otherSvcId });
  worded(await move("ownerA", r.id, other.id), "a different class");
  // a started session and a cancelled one
  const started = await makeSession({ startsAt: new Date(Date.now() - 3_600_000).toISOString() });
  worded(await move("ownerA", r.id, started.id), "started session");
  const cancelled = await makeSession({ status: "cancelled" });
  worded(await move("ownerA", r.id, cancelled.id), "cancelled session");
  worded(await move("ownerA", r.id, "00000000-0000-0000-0000-000000000000"), "unknown session");
  // a person who already cancelled, and one who isn't in a class
  const gone = await join(a);
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", gone.id);
  worded(await move("ownerA", gone.id, s2.id), "a cancelled spot");
  const solo = await book({ at: at(weekday("chg-solo"), "13:00") });
  worded(await move("ownerA", solo.data.id, s2.id), "not a class booking");
  await admin.from("bookings").delete().eq("id", solo.data.id);
  assert.equal(await taken(a), 2, "nothing was moved by the refused attempts");
});

test("only people on the team can move anyone", async () => {
  const a = await makeSession({});
  const b = await makeSession({});
  const r = await join(a);
  for (const who of ["ownerB", "stranger"]) {
    const x = await move(who, r.id, b.id);
    assert.ok(x.error, `${who} must not move people`);
  }
  const anon = await pub.rpc("move_class_booking", { p_booking: r.id, p_session: b.id });
  assert.ok(anon.error, "the public can't move people");
  assert.equal(await taken(a), 1);
  for (const who of ["staffA1", "adminA"]) {
    const x = await move(who, r.id, b.id);
    assert.equal(x.error, null, `${who}: ${x.error?.message}`);
    const back = await move(who, r.id, a.id);
    assert.equal(back.error, null, `${who} back: ${back.error?.message}`);
  }
});

test("two moves into the last spot: exactly one wins", async () => {
  const target = await makeSession({ capacity: 1 });
  const from = await makeSession({ capacity: 6 });
  const people = [];
  for (let i = 0; i < 5; i++) people.push(await join(from, `Racer ${i}`));
  const results = await Promise.all(people.map((p) => move("ownerA", p.id, target.id)));
  assert.equal(results.filter((r) => !r.error).length, 1);
  for (const r of results.filter((x) => x.error)) worded(r, "race loser");
  assert.equal(await taken(target), 1);
  assert.equal(await taken(from), 4);
});

test("a move and an online booking racing for the last spot never go over", async () => {
  const target = await makeSession({ capacity: 1 });
  const from = await makeSession({ capacity: 3 });
  const p = await join(from);
  const results = await Promise.all([
    move("ownerA", p.id, target.id),
    pub.rpc("create_public_session_booking", { p_org: st.orgA.id, p_session: target.id, p_name: "Online", p_email: email(), p_phone: "", p_notes: "" }),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(await taken(target), 1);
});

test("moving a session takes everyone in it along, and frees the old time for the instructor", async () => {
  const s = await makeSession({ time: "10:00", capacity: 5 });
  const people = [await join(s, "Ann"), await join(s, "Bo")];
  await admin.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("session_id", s.id);
  const key2 = weekday(`chg${++day}`);
  const newStart = at(key2, "15:00");
  const m = await moveSession("ownerA", s.id, newStart, SAM());
  assert.equal(m.error, null, m.error?.message);
  assert.deepEqual(m.data.booking_ids.sort(), people.map((p) => p.id).sort());
  const { data: sess } = await admin.from("class_sessions").select("starts_at, ends_at, blocked_until, member_id").eq("id", s.id).single();
  assert.equal(new Date(sess.starts_at).getTime(), new Date(newStart).getTime());
  assert.equal(new Date(sess.ends_at).getTime() - new Date(sess.starts_at).getTime(), 3_600_000, "same length");
  assert.equal(sess.member_id, SAM());
  const { data: rows } = await admin.from("bookings").select("starts_at, ends_at, member_id, reminder_sent_at").eq("session_id", s.id);
  for (const r of rows) {
    assert.equal(new Date(r.starts_at).getTime(), new Date(newStart).getTime());
    assert.equal(r.member_id, SAM());
    assert.equal(r.reminder_sent_at, null);
  }
  // the old time is free again for one-on-one booking with the old instructor; the new one is busy for Sam
  const oldTime = await book({ at: at(weekday(`chg${day - 1}`), "10:00") });
  assert.equal(oldTime.error, null, oldTime.error?.message);
  await admin.from("bookings").delete().eq("id", oldTime.data.id);
  const busy = await pub.rpc("get_public_busy", { p_org: st.orgA.id, p_from: new Date(new Date(newStart).getTime() - 3_600_000).toISOString(), p_to: new Date(new Date(newStart).getTime() + 7_200_000).toISOString() });
  assert.ok(busy.data.some((b) => b.member_id === SAM() && new Date(b.starts_at).getTime() === new Date(newStart).getTime()), "the new time is Sam's busy time");
});

test("a session can't move onto the instructor's other class or booking, into the past, or once cancelled", async () => {
  const a = await makeSession({ time: "10:00" });
  const b = await makeSession({ time: "13:00" });
  // onto another session of the same instructor (b is on the latest day)
  const clash = await moveSession("ownerA", a.id, at(weekday(`chg${day}`), "13:30"));
  assert.ok(clash.error, "overlapping another class of the same person is refused");
  assert.equal(b.member_id, SARA());
  // onto a one-on-one booking
  const day3 = weekday(`chg${++day}`);
  const one = await book({ at: at(day3, "16:00") });
  assert.equal(one.error, null, one.error?.message);
  const over = await moveSession("ownerA", a.id, at(day3, "15:45"));
  assert.ok(over.error, "overlapping a booking is refused");
  await admin.from("bookings").delete().eq("id", one.data.id);
  // past, started and cancelled
  worded(await moveSession("ownerA", a.id, new Date(Date.now() - 3_600_000).toISOString()), "a time in the past");
  const started = await makeSession({ startsAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), member: SAM() });
  worded(await moveSession("ownerA", started.id, at(weekday(`chg${++day}`), "11:00")), "a session that has started");
  const cancelled = await makeSession({ status: "cancelled" });
  worded(await moveSession("ownerA", cancelled.id, at(weekday(`chg${++day}`), "11:00")), "a cancelled session");
  // nothing moved
  const { data: still } = await admin.from("class_sessions").select("starts_at").eq("id", a.id).single();
  assert.equal(new Date(still.starts_at).getTime(), new Date(a.starts_at).getTime());
});

test("only the team can move a session, and a plain edit of a booked session is still refused", async () => {
  const s = await makeSession({});
  await join(s);
  const t = at(weekday(`chg${++day}`), "10:00");
  for (const who of ["ownerB", "stranger"]) assert.ok((await moveSession(who, s.id, t)).error, `${who} must not move it`);
  assert.ok((await pub.rpc("move_class_session", { p_session: s.id, p_starts_at: t })).error, "the public can't");
  const plain = await admin.from("class_sessions").update({ starts_at: t, ends_at: new Date(new Date(t).getTime() + 3_600_000).toISOString(), blocked_until: new Date(new Date(t).getTime() + 3_600_000).toISOString() }).eq("id", s.id);
  assert.ok(plain.error, "a plain update of a booked session is refused");
  const ok = await moveSession("staffA1", s.id, t);
  assert.equal(ok.error, null, ok.error?.message);
});

test("sessions can carry a series, and the team can read it", async () => {
  const series = crypto.randomUUID();
  const a = await makeSession({ series, index: 0 });
  await makeSession({ series, index: 1 });
  const rows = await as.staffA1.from("class_sessions").select("id, series_id, series_index").eq("series_id", series).order("series_index");
  assert.equal(rows.data.length, 2);
  assert.equal(rows.data[0].id, a.id);
  const other = await as.ownerB.from("class_sessions").select("id").eq("series_id", series);
  assert.equal(other.data?.length ?? 0, 0, "another business can't see it");
});
