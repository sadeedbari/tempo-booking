// Recurring appointments: how a series is booked, previewed, shown and cancelled, and who can see what.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, pub, signedIn, st, TECHNICAL, TZ, unique, weekday } from "./util.mjs";

const as = {};
let svcId;
let slot = 0;
const TIMES = Array.from({ length: 32 }, (_, i) => `${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${["00", "15", "30", "45"][i % 4]}`);
const nextTime = () => TIMES[slot % TIMES.length];

before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
  const { data, error } = await admin.from("services").insert({ org_id: st.orgA.id, name: "Series Test", slug: "series-test", duration_minutes: 15, price_cents: 0, allow_series: true, position: 98 }).select("id").single();
  assert.equal(error, null, error?.message);
  svcId = data.id;
});
after(async () => {
  await admin.from("services").delete().eq("id", svcId);
});

const localTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

function series(o = {}) {
  return pub.rpc("create_public_booking_series", {
    p_org: st.orgA.id,
    p_service: o.service ?? svcId,
    p_member: st.orgA.members.sara,
    p_starts_at: o.startsAt ?? at(weekday(`series${++slot}`), nextTime()),
    p_name: "Series Tester",
    p_email: o.email ?? `${unique("ser")}@customers.tempo-e2e.test`,
    p_phone: "",
    p_notes: "",
    p_location: st.orgA.locations.qw,
    p_address: "",
    p_interval_weeks: o.weeks ?? 1,
    p_count: o.count ?? 3,
    p_dry_run: o.dry ?? false,
    ...(o.answers === undefined ? {} : { p_answers: o.answers }),
  });
}
async function singleBooking() {
  const r = await pub.rpc("create_public_booking", { p_org: st.orgA.id, p_service: svcId, p_member: st.orgA.members.sara, p_starts_at: at(weekday(`single${++slot}`), nextTime()), p_name: "Single", p_email: `${unique("one")}@customers.tempo-e2e.test`, p_phone: "", p_notes: "", p_location: st.orgA.locations.qw, p_address: "" });
  assert.equal(r.error, null, r.error?.message);
  return { data: { manage_token: r.data.manage_token } };
}
const rowsOf = async (seriesId) => (await admin.from("bookings").select("id, starts_at, status, series_index, manage_token, customer_id").eq("series_id", seriesId).order("starts_at")).data;
const worded = (r, what) => {
  assert.ok(r.error, `${what}: should be refused`);
  assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
  assert.ok(!TECHNICAL.test(r.error.message), `${what}: technical words leaked: ${r.error.message}`);
};

test("a series books every date at the same time, one customer, indexed in order", async () => {
  const email = `${unique("same")}@customers.tempo-e2e.test`;
  const r = await series({ weeks: 2, count: 4, email });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data.booked.length, 4);
  assert.equal(r.data.skipped.length, 0);
  const rows = await rowsOf(r.data.series_id);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((x) => x.series_index), [0, 1, 2, 3]);
  assert.ok(rows.every((x) => x.status === "confirmed"));
  assert.equal(new Set(rows.map((x) => localTime(x.starts_at))).size, 1, "same local time on every date");
  const gaps = rows.slice(1).map((x, i) => Math.round((new Date(x.starts_at) - new Date(rows[i].starts_at)) / 86_400_000));
  assert.ok(gaps.every((g) => g === 14 || g === 14), `two weeks apart (got ${gaps})`);
  assert.equal(new Set(rows.map((x) => x.customer_id)).size, 1, "one customer");
  const { data: s } = await admin.from("booking_series").select("interval_weeks, count_requested, customer_id, source").eq("id", r.data.series_id).single();
  assert.deepEqual([s.interval_weeks, s.count_requested, s.source], [2, 4, "online"]);
  assert.equal(s.customer_id, rows[0].customer_id);
});

test("the same wall-clock time is kept across a clock change", async (t) => {
  // find the next clock change (Toronto) within the booking window
  const offset = (d) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName").value; return p; };
  let change = null;
  for (let i = 3; i < 55 && !change; i++) {
    const a = new Date(Date.now() + i * 86_400_000), b = new Date(Date.now() + (i + 1) * 86_400_000);
    if (offset(a) !== offset(b)) change = b;
  }
  if (!change) return t.skip("no clock change in the next 55 days");
  // a weekday just before the change, so a weekly series of 3 crosses it
  const start = new Date(change.getTime() - 2 * 86_400_000);
  while ([0, 6].includes(start.getUTCDay())) start.setUTCDate(start.getUTCDate() - 1);
  const day = start.toISOString().slice(0, 10);
  const r = await series({ startsAt: at(day, "15:10"), weeks: 1, count: 3 });
  if (r.error) return t.skip(`couldn't book across the change: ${r.error.message}`);
  const rows = await rowsOf(r.data.series_id);
  assert.equal(rows.length, 3);
  assert.deepEqual([...new Set(rows.map((x) => localTime(x.starts_at)))], ["15:10"], "stays 15:10 local on every date, even across the change");
  const utcHours = new Set(rows.map((x) => new Date(x.starts_at).getUTCHours()));
  assert.equal(utcHours.size, 2, "the UTC time moves by an hour when the clocks change");
});

test("a preview books nothing but reports each date; required questions don't get in its way, but a real booking still needs them", async () => {
  const { data: q } = await admin.from("service_questions").insert({ org_id: st.orgA.id, service_id: svcId, label: "Any allergies?", type: "text", required: true }).select("id").single();
  try {
    const email = `${unique("prev")}@customers.tempo-e2e.test`;
    const before = (await admin.from("bookings").select("id", { count: "exact", head: true }).eq("service_id", svcId)).count;
    const startsAt = at(weekday(`preview${++slot}`), nextTime());
    const p = await series({ dry: true, email, startsAt, weeks: 1, count: 4 });
    assert.equal(p.error, null, p.error?.message);
    assert.equal(p.data.booked.length, 4);
    const after = (await admin.from("bookings").select("id", { count: "exact", head: true }).eq("service_id", svcId)).count;
    assert.equal(after, before, "a preview must not leave bookings behind");
    assert.equal((await admin.from("customers").select("id").eq("org_id", st.orgA.id).eq("email", email)).data.length, 0, "or a customer");
    assert.equal((await admin.from("booking_series").select("id").eq("org_id", st.orgA.id).eq("first_starts_at", startsAt)).data.length, 0, "or a series");
    // the same request for real is refused until the question is answered
    worded(await series({ email, startsAt, weeks: 1, count: 4 }), "required answer missing");
    const ok = await series({ email, startsAt, weeks: 1, count: 4, answers: { [q.id]: "none" } });
    assert.equal(ok.error, null, ok.error?.message);
    const rows = await rowsOf(ok.data.series_id);
    const answers = (await admin.from("bookings").select("answers").in("id", rows.map((x) => x.id))).data;
    assert.ok(answers.every((a) => a.answers?.[0]?.value === "none"), "every date keeps the answers");
  } finally {
    await admin.from("service_questions").delete().eq("id", q.id);
  }
});

test("a preview that includes a clash says which date is unavailable", async () => {
  const startsAt = at(weekday(`clash${++slot}`), nextTime());
  const second = new Date(new Date(startsAt).getTime() + 7 * 86_400_000).toISOString();
  await admin.from("time_off").insert({ org_id: st.orgA.id, member_id: st.orgA.members.sara, starts_at: new Date(new Date(second).getTime() - 14_400_000).toISOString(), ends_at: new Date(new Date(second).getTime() + 14_400_000).toISOString(), reason: "e2e clash" });
  const p = await series({ dry: true, startsAt, weeks: 1, count: 3 });
  assert.equal(p.error, null, p.error?.message);
  assert.equal(p.data.booked.length, 2);
  assert.equal(p.data.skipped.length, 1);
  assert.equal(p.data.skipped[0].index, 1);
  assert.ok(!TECHNICAL.test(p.data.skipped[0].reason), `reason in plain words: ${p.data.skipped[0].reason}`);
});

test("dates that don't fit are skipped and reported; the rest are booked; none is booked twice", async () => {
  const startsAt = at(weekday(`skip${++slot}`), nextTime());
  const third = new Date(new Date(startsAt).getTime() + 14 * 86_400_000);
  await admin.from("time_off").insert({ org_id: st.orgA.id, member_id: st.orgA.members.sara, starts_at: new Date(third.getTime() - 14_400_000).toISOString(), ends_at: new Date(third.getTime() + 14_400_000).toISOString(), reason: "e2e skip" });
  const r = await series({ startsAt, weeks: 1, count: 4 });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data.booked.length, 3);
  assert.deepEqual(r.data.skipped.map((s) => s.index), [2]);
  const rows = await rowsOf(r.data.series_id);
  assert.deepEqual(rows.map((x) => x.series_index), [0, 1, 3], "the skipped date leaves a gap in the numbering, not a hole in the data");
  assert.equal(new Set(rows.map((x) => x.starts_at)).size, 3);
});

test("if the first date can't be booked nothing is created at all", async () => {
  const startsAt = at(weekday(`first${++slot}`), nextTime());
  const email = `${unique("first")}@customers.tempo-e2e.test`;
  await admin.from("time_off").insert({ org_id: st.orgA.id, member_id: st.orgA.members.sara, starts_at: new Date(new Date(startsAt).getTime() - 14_400_000).toISOString(), ends_at: new Date(new Date(startsAt).getTime() + 14_400_000).toISOString(), reason: "e2e first" });
  const r = await series({ startsAt, email, weeks: 1, count: 3 });
  worded(r, "first date unavailable");
  assert.equal((await admin.from("customers").select("id").eq("org_id", st.orgA.id).eq("email", email)).data.length, 0, "no customer left behind");
  assert.equal((await admin.from("booking_series").select("id").eq("org_id", st.orgA.id).eq("first_starts_at", startsAt)).data.length, 0, "no series left behind");
});

test("dates beyond how far ahead people may book are skipped", async () => {
  const { data: org } = await admin.from("organizations").select("max_advance_days").eq("id", st.orgA.id).single();
  const startsAt = at(weekday(`far${++slot}`), nextTime());
  const days = Math.round((new Date(startsAt) - Date.now()) / 86_400_000);
  await admin.from("organizations").update({ max_advance_days: days + 9 }).eq("id", st.orgA.id);
  try {
    const p = await series({ dry: true, startsAt, weeks: 1, count: 4 }); // dates at +0, +7, +14, +21 days; only the first two fit
    assert.equal(p.error, null, p.error?.message);
    assert.equal(p.data.booked.length, 2);
    assert.equal(p.data.skipped.length, 2);
    assert.match(p.data.skipped[0].reason, /far/i);
  } finally {
    await admin.from("organizations").update({ max_advance_days: org.max_advance_days }).eq("id", st.orgA.id);
  }
});

test("the rules: how often, how many, and which services allow it", async () => {
  worded(await series({ weeks: 5 }), "every 5 weeks");
  worded(await series({ weeks: 0 }), "every 0 weeks");
  worded(await series({ count: 1 }), "one date");
  worded(await series({ count: 27 }), "27 dates");
  // not allowed on the service
  await admin.from("services").update({ allow_series: false }).eq("id", svcId);
  worded(await series({}), "service doesn't allow it");
  await admin.from("services").update({ allow_series: true, auto_approve: false }).eq("id", svcId);
  worded(await series({}), "service needs approval");
  // an online deposit isn't supported for a series
  await admin.from("services").update({ auto_approve: true, deposit_cents: 3000, price_cents: 6000 }).eq("id", svcId);
  await admin.from("organizations").update({ stripe_charges_enabled: true }).eq("id", st.orgA.id);
  try {
    worded(await series({}), "deposit charged online");
  } finally {
    await admin.from("organizations").update({ stripe_charges_enabled: false }).eq("id", st.orgA.id);
    await admin.from("services").update({ deposit_cents: 0, price_cents: 0 }).eq("id", svcId);
  }
  const okAt = at(weekday("rules-ok"), "13:05");
  const ok = await series({ startsAt: okAt });
  assert.equal(ok.error, null, `${okAt}: ${ok.error?.message}`);
});

test("the public booking data says which services allow repeating", async () => {
  const { data } = await pub.rpc("get_public_org", { p_slug: st.orgA.slug });
  const mine = data.services.find((s) => s.id === svcId);
  assert.equal(mine.allow_series, true);
  const haircut = data.services.find((s) => s.id === st.orgA.services.haircut);
  assert.equal(haircut.allow_series, false);
});

test("two people racing for the same series never double-book", async () => {
  const startsAt = at(weekday(`race${++slot}`), nextTime());
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => series({ startsAt, weeks: 1, count: 3, email: `${unique(`race${i}`)}@customers.tempo-e2e.test` })));
  const wins = results.filter((r) => !r.error);
  assert.equal(wins.length, 1, `exactly one series gets the first date (got ${wins.length})`);
  for (const r of results.filter((x) => x.error)) worded(r, "race loser");
  const { data: all } = await admin.from("bookings").select("starts_at").eq("service_id", svcId).eq("member_id", st.orgA.members.sara).in("status", ["confirmed", "pending_payment"]);
  assert.equal(new Set(all.map((x) => x.starts_at)).size, all.length, "no two active bookings share a start time");
});

test("the manage page's data: the dates, where this one sits, and nothing private about the others", async () => {
  const r = await series({ weeks: 1, count: 4 });
  const rows = await rowsOf(r.data.series_id);
  const view = await pub.rpc("get_series_by_token", { p_token: rows[2].manage_token });
  assert.equal(view.error, null);
  assert.equal(view.data.total, 4);
  assert.equal(view.data.index, 3);
  assert.equal(view.data.interval_weeks, 1);
  assert.deepEqual(view.data.items.map((i) => i.current), [false, false, true, false]);
  for (const i of view.data.items) assert.deepEqual(Object.keys(i).sort(), ["current", "starts_at", "status"], "no tokens, names or ids of the other dates");
  // not a series, a short token, a made-up token
  const single = await singleBooking();
  assert.equal((await pub.rpc("get_series_by_token", { p_token: single.data.manage_token })).data, null);
  assert.equal((await pub.rpc("get_series_by_token", { p_token: "short" })).data, null);
  assert.equal((await pub.rpc("get_series_by_token", { p_token: "x".repeat(48) })).data, null);
});

test("cancelling this and the later dates keeps the earlier ones; the window and states are respected", async () => {
  const r = await series({ weeks: 1, count: 4 });
  const rows = await rowsOf(r.data.series_id);
  assert.equal(rows.length, 4);
  const cancel = await pub.rpc("cancel_series_following_by_token", { p_token: rows[1].manage_token, p_reason: "moving away" });
  assert.equal(cancel.error, null, cancel.error?.message);
  assert.equal(cancel.data.cancelled, 3);
  assert.equal(cancel.data.first, rows[1].id);
  const after = await rowsOf(r.data.series_id);
  assert.deepEqual(after.map((x) => x.status), ["confirmed", "cancelled", "cancelled", "cancelled"]);
  const { data: reason } = await admin.from("bookings").select("cancel_reason, cancelled_at").eq("id", rows[3].id).single();
  assert.equal(reason.cancel_reason, "moving away");
  assert.ok(reason.cancelled_at);
  // again: already cancelled
  worded(await pub.rpc("cancel_series_following_by_token", { p_token: rows[1].manage_token, p_reason: "" }), "already cancelled");
  // the view marks them
  const view = await pub.rpc("get_series_by_token", { p_token: rows[0].manage_token });
  assert.deepEqual(view.data.items.map((i) => i.status), ["confirmed", "cancelled", "cancelled", "cancelled"]);
  // inside the cancellation window, online cancelling is closed (as for a single booking)
  const { data: org } = await admin.from("organizations").select("cancellation_window_hours").eq("id", st.orgA.id).single();
  await admin.from("organizations").update({ cancellation_window_hours: 100000 }).eq("id", st.orgA.id);
  try {
    worded(await pub.rpc("cancel_series_following_by_token", { p_token: rows[0].manage_token, p_reason: "" }), "inside the window");
  } finally {
    await admin.from("organizations").update({ cancellation_window_hours: org.cancellation_window_hours }).eq("id", st.orgA.id);
  }
  // a booking that isn't in a series can't use it
  const single = await singleBooking();
  worded(await pub.rpc("cancel_series_following_by_token", { p_token: single.data.manage_token, p_reason: "" }), "not a series");
  assert.ok((await pub.rpc("cancel_series_following_by_token", { p_token: "nope", p_reason: "" })).error);
});

test("one date of a series can still be cancelled on its own, and the others are untouched", async () => {
  const r = await series({ weeks: 1, count: 3 });
  const rows = await rowsOf(r.data.series_id);
  const one = await pub.rpc("cancel_booking_by_token", { p_token: rows[1].manage_token, p_reason: "" });
  assert.equal(one.error, null, one.error?.message);
  assert.deepEqual((await rowsOf(r.data.series_id)).map((x) => x.status), ["confirmed", "cancelled", "confirmed"]);
});

test("who can see and change series records", async () => {
  const r = await series({});
  const id = r.data.series_id;
  for (const who of ["ownerA", "adminA", "staffA1"]) {
    const rows = await as[who].from("booking_series").select("id").eq("id", id);
    assert.equal(rows.data?.length, 1, `${who} should see their team's series`);
  }
  for (const who of ["ownerB", "stranger"]) {
    assert.equal((await as[who].from("booking_series").select("id").eq("org_id", st.orgA.id)).data?.length ?? 0, 0, `${who} must not see them`);
    assert.equal((await as[who].from("booking_series").update({ count_requested: 2 }).eq("id", id).select()).data?.length ?? 0, 0, `${who} must not change them`);
    assert.equal((await as[who].from("booking_series").delete().eq("id", id).select()).data?.length ?? 0, 0, `${who} must not delete them`);
  }
  assert.equal((await pub.from("booking_series").select("id")).data?.length ?? 0, 0, "visitors can't read the table");
  const row = { org_id: st.orgA.id, interval_weeks: 1, count_requested: 3, first_starts_at: new Date().toISOString(), source: "manual" };
  assert.equal((await as.staffA1.from("booking_series").insert(row)).error, null, "team members can create a series");
  assert.ok((await as.ownerB.from("booking_series").insert(row)).error, "other teams can't create one in this team");
  assert.ok((await pub.from("booking_series").insert(row)).error, "visitors can't create one");
  assert.equal((await as.staffA1.from("booking_series").delete().eq("id", id).select()).data?.length ?? 0, 0, "plain staff can't delete");
  assert.equal((await as.ownerA.from("booking_series").delete().eq("id", id).select()).data?.length, 1, "owners can");
});
