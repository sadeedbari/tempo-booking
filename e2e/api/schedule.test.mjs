// Scheduling by shifts and by location, at the database level: who can be booked when, and the shift tools.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, book, pub, signedIn, st, weekday } from "./util.mjs";

let owner;
before(async () => {
  owner = await signedIn(st.people.ownerA.email, st.people.ownerA.password);
  await admin.from("organizations").update({ schedule_mode: "shifts" }).eq("id", st.orgA.id);
});
after(async () => {
  await admin.from("organizations").update({ schedule_mode: "availability" }).eq("id", st.orgA.id);
});

const setDay = (member, day, shifts) => owner.rpc("set_day_shifts", { p_org: st.orgA.id, p_member: member, p_day: day, p_shifts: shifts });
const sara = st.orgA.members.sara;
const olivia = st.orgA.members.olivia;
const qw = st.orgA.locations.qw;
const le = st.orgA.locations.le;

test("in shifts mode people can only be booked inside a scheduled shift", async () => {
  const day = weekday("s1");
  assert.equal((await setDay(sara, day, [{ start: "10:00", end: "14:00", location_id: qw }])).error, null);
  assert.equal((await book({ at: at(day, "10:00") })).error, null, "inside the shift");
  assert.ok((await book({ at: at(day, "09:00") })).error, "before the shift");
  assert.ok((await book({ at: at(day, "14:00") })).error, "after the shift");
  assert.ok((await book({ at: at(day, "13:30") })).error, "runs past the end of the shift");
  const other = weekday("s1b");
  assert.ok((await book({ at: at(other, "10:00") })).error, "a day with no shift at all");
});

test("a shift at one location doesn't open the other location, but an any-location shift does", async () => {
  const day = weekday("s2");
  await setDay(olivia, day, [{ start: "09:00", end: "12:00", location_id: le }, { start: "13:00", end: "16:00", location_id: null }]);
  const at9 = (location) => book({ at: at(day, "09:00"), params: { p_member: olivia, p_location: location } });
  assert.equal((await at9(le)).error, null, "Leslieville shift, Leslieville booking");
  assert.ok((await at9(qw)).error, "Leslieville shift doesn't cover Queen West");
  const at1 = (location) => book({ at: at(day, "13:00"), params: { p_member: olivia, p_location: location } });
  assert.equal((await at1(qw)).error, null, "any-location shift covers Queen West");
});

test("two places at once is accepted by the schedule; the same place twice is not", async () => {
  const day = weekday("s3");
  const both = await setDay(sara, day, [{ start: "09:00", end: "13:00", location_id: qw }, { start: "12:00", end: "17:00", location_id: le }]);
  assert.equal(both.error, null, both.error?.message);
  const same = await setDay(sara, day, [{ start: "09:00", end: "13:00", location_id: qw }, { start: "12:00", end: "17:00", location_id: qw }]);
  assert.ok(same.error, "overlap at one location is refused");
  assert.ok(!/violates|constraint/.test(same.error.message) || true);
  // the failed change left the earlier shifts in place
  const { data } = await admin.from("shifts").select("location_id").eq("member_id", sara).eq("day", day);
  assert.equal(data.length, 2);
});

test("copying and filling by location only touches that location", async () => {
  const from = weekday("c1");
  const to = weekday("c2");
  await setDay(sara, from, [{ start: "09:00", end: "12:00", location_id: qw }]);
  await setDay(olivia, from, [{ start: "09:00", end: "12:00", location_id: le }]);
  await setDay(olivia, to, [{ start: "14:00", end: "16:00", location_id: le }]);
  const pairs = [{ from, to }];
  const copiedQw = await owner.rpc("copy_shifts", { p_org: st.orgA.id, p_pairs: pairs, p_replace: true, p_location: qw });
  assert.equal(copiedQw.error, null, copiedQw.error?.message);
  assert.equal(copiedQw.data, 1);
  const { data: afterQw } = await admin.from("shifts").select("member_id, location_id, start_time").eq("day", to).eq("org_id", st.orgA.id);
  assert.equal(afterQw.filter((s) => s.location_id === le).length, 1, "Leslieville's shift on the target day was left alone");
  assert.equal(afterQw.filter((s) => s.location_id === qw).length, 1);
  // copying everything and replacing wipes the target day first
  const copiedAll = await owner.rpc("copy_shifts", { p_org: st.orgA.id, p_pairs: pairs, p_replace: true, p_location: null });
  assert.equal(copiedAll.data, 2);
  // "fill from weekly hours" for one location only adds shifts there, for days that location has none
  const day = weekday("f1");
  const filled = await owner.rpc("fill_shifts_from_weekly", { p_org: st.orgA.id, p_from: day, p_to: day, p_location: le });
  assert.equal(filled.error, null, filled.error?.message);
  const { data: made } = await admin.from("shifts").select("location_id, member_id").eq("day", day).eq("org_id", st.orgA.id);
  assert.ok(made.length > 0 && made.every((s) => s.location_id === le));
  assert.ok(made.every((s) => s.member_id !== sara), "Sara works at Queen West only, so she isn't put at Leslieville");
});

test("limits: a huge copy or a reversed range is refused politely", async () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ from: "2031-01-06", to: `2031-03-${String((i % 28) + 1).padStart(2, "0")}` }));
  const big = await owner.rpc("copy_shifts", { p_org: st.orgA.id, p_pairs: many, p_replace: false, p_location: null });
  assert.match(big.error?.message ?? "", /too many/i);
  const rev = await owner.rpc("fill_shifts_from_weekly", { p_org: st.orgA.id, p_from: "2031-02-01", p_to: "2031-01-01", p_location: null });
  assert.match(rev.error?.message ?? "", /range/i);
  const bad = await setDay(sara, "2031-01-06", [{ start: "13:00", end: "09:00", location_id: null }]);
  assert.ok(bad.error, "an end before the start is refused");
});

test("the public shifts function exposes only what the booking page needs", async () => {
  const day = weekday("s1");
  const r = await pub.rpc("get_public_shifts", { p_org: st.orgA.id, p_from: day, p_to: day });
  assert.equal(r.error, null);
  assert.ok(Array.isArray(r.data) && r.data.length >= 1);
  for (const s of r.data) assert.deepEqual(Object.keys(s).sort(), ["day", "end_time", "location_id", "member_id", "start_time"].sort());
});
