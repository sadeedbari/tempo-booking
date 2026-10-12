// Public booking rules, checked straight against the database functions the booking page calls.
import test from "node:test";
import assert from "node:assert/strict";
import { admin, at, book, pub, saturday, st, TECHNICAL, unique, weekday } from "./util.mjs";

const clean = (r, what) => {
  const msg = r.error?.message ?? "";
  assert.ok(!TECHNICAL.test(msg), `${what}: technical message leaked to customer: ${msg}`);
};

test("a normal booking is confirmed and returns a private manage link token", async () => {
  const r = await book({ at: at(weekday(9), "10:00") });
  assert.equal(r.error, null);
  assert.equal(r.data.status, "confirmed");
  assert.match(r.data.manage_token, /^[a-f0-9]{48}$/);
});

test("the same time can't be booked twice for the same person", async () => {
  const when = at(weekday(9), "11:00");
  assert.equal((await book({ at: when })).error, null);
  const second = await book({ at: when });
  assert.ok(second.error, "second booking should fail");
  assert.match(second.error.message, /taken|pick another/i);
  clean(second, "double booking");
  // an overlapping start (30 minutes later) is also refused
  const third = await book({ at: at(weekday(9), "11:30") });
  assert.match(third.error?.message ?? "", /taken|pick another/i);
});

test("10 people racing for one slot: exactly one wins, the rest get a friendly message", async () => {
  const when = at(weekday(10), "14:00");
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => book({ at: when, name: `Racer ${i}` })));
  const wins = results.filter((r) => !r.error);
  assert.equal(wins.length, 1, `wins: ${wins.length}`);
  for (const r of results.filter((x) => x.error)) clean(r, "race");
});

test("times that can't work are refused politely", async () => {
  const cases = {
    "weekend (no hours)": at(saturday(9), "10:00"),
    "before opening": at(weekday(9), "07:00"),
    "after closing": at(weekday(9), "17:30"),
    "runs past closing": at(weekday(9), "16:30"),
    "in the past": at("2020-01-06", "10:00"),
    "minutes from now": new Date(Date.now() + 5 * 60_000).toISOString(),
    "far in the future": at("2031-03-03", "10:00"),
  };
  for (const [name, when] of Object.entries(cases)) {
    const r = await book({ at: when });
    assert.ok(r.error, `${name} should be refused`);
    clean(r, name);
    assert.ok(r.error.message.length > 5, name);
  }
});

test("customer details are validated", async () => {
  const day = weekday(11);
  for (const [name, o] of Object.entries({
    "no name": { name: "   " },
    "no email": { email: "" },
    "bad email": { email: "not-an-email" },
    "email with spaces": { email: "a b@c.com" },
  })) {
    const r = await book({ at: at(day, "09:00"), ...o });
    assert.ok(r.error, `${name} should be refused`);
    clean(r, name);
  }
});

test("odd but valid customer input is stored safely (long names, unicode, markup, quotes)", async () => {
  const day = weekday(12);
  const nasty = `<script>alert(1)</script> "Robert'); DROP TABLE bookings;--" Zoë 李雷 ‮`;
  const r = await book({ at: at(day, "09:00"), name: nasty, notes: "x".repeat(2000), email: `${unique()}@customers.tempo-e2e.test`, phone: "+1 (416) 555-0100 ext. 5" });
  assert.equal(r.error, null, r.error?.message);
  const { data: c } = await admin.from("bookings").select("customer:customers(name)").eq("id", r.data.id).single();
  assert.equal(c.customer.name, nasty, "name stored exactly as typed (escaped on display, never executed)");
  const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("org_id", st.orgA.id);
  assert.ok(count > 0, "bookings table still intact");
});

test("the same email books twice: one customer record, details updated", async () => {
  const email = `${unique("same")}@customers.tempo-e2e.test`;
  assert.equal((await book({ at: at(weekday(12), "10:00"), email, name: "First Name" })).error, null);
  assert.equal((await book({ at: at(weekday(12), "12:00"), email, name: "New Name", phone: "416-555-0111" })).error, null);
  const { data } = await admin.from("customers").select("name, phone").eq("org_id", st.orgA.id).eq("email", email);
  assert.equal(data.length, 1);
  assert.equal(data[0].name, "New Name");
  assert.equal(data[0].phone, "416-555-0111");
});

test("email addresses are matched without regard to capital letters or spaces around them", async () => {
  const base = unique("case");
  assert.equal((await book({ at: at(weekday(12), "13:00"), email: `${base}@Customers.Tempo-E2E.test` })).error, null);
  assert.equal((await book({ at: at(weekday(12), "14:00"), email: `  ${base}@customers.tempo-e2e.test ` })).error, null);
  const { data } = await admin.from("customers").select("id").eq("org_id", st.orgA.id).ilike("email", `${base}@%`);
  assert.equal(data.length, 1);
});

test("service rules: wrong staff, hidden service, other team's service, garbage ids", async () => {
  const day = weekday(13);
  // Colour is only done by Sara
  const wrongStaff = await book({ at: at(day, "10:00"), params: { p_service: st.orgA.services.colour, p_member: st.orgA.members.olivia } });
  assert.ok(wrongStaff.error); clean(wrongStaff, "wrong staff");
  const hidden = await book({ at: at(day, "10:00"), params: { p_service: st.orgA.services.hidden } });
  assert.match(hidden.error?.message ?? "", /not found/i);
  const foreign = await book({ at: at(day, "10:00"), params: { p_service: st.orgB.services.physio } });
  assert.match(foreign.error?.message ?? "", /not found/i);
  const garbage = await pub.rpc("create_public_booking", { p_org: "nope", p_service: "nope", p_member: null, p_starts_at: "yesterday", p_name: "a", p_email: "a@b.co", p_phone: "", p_notes: "", p_location: null, p_address: "" });
  assert.ok(garbage.error);
  const nilOrg = await pub.rpc("create_public_booking", { p_org: "00000000-0000-0000-0000-000000000000", p_service: st.orgA.services.haircut, p_member: null, p_starts_at: at(day, "10:00"), p_name: "a", p_email: "a@b.co", p_phone: "", p_notes: "", p_location: null, p_address: "" });
  assert.ok(nilOrg.error); clean(nilOrg, "unknown team");
});

test("'any available' picks someone eligible and never double-books", async () => {
  const day = weekday(14);
  const when = at(day, "10:00");
  const a = await book({ at: when, params: { p_member: null } });
  const b = await book({ at: when, params: { p_member: null } });
  assert.equal(a.error, null);
  assert.equal(b.error, null, "second any-staff booking goes to the other eligible person");
  assert.notEqual(a.data.member_id, b.data.member_id);
  const c = await book({ at: when, params: { p_member: null } });
  assert.ok(c.error, "nobody left for a third");
  clean(c, "no one left");
});

test("location rules: a person only works where they're assigned", async () => {
  const day = weekday(14);
  // Sara is assigned to Queen West only
  const wrongPlace = await book({ at: at(day, "13:00"), params: { p_member: st.orgA.members.sara, p_location: st.orgA.locations.le } });
  assert.ok(wrongPlace.error, "Sara doesn't work at Leslieville");
  clean(wrongPlace, "wrong location");
  const none = await book({ at: at(day, "13:00"), params: { p_location: null } });
  assert.match(none.error?.message ?? "", /choose a location/i);
});

test("a service that needs approval creates a request; one that needs an address insists on it", async () => {
  const day = weekday(15);
  const base = { params: { p_service: st.orgA.services.homevisit, p_member: st.orgA.members.sam, p_location: st.orgA.locations.le } };
  const noAddress = await book({ at: at(day, "10:00"), ...base });
  assert.match(noAddress.error?.message ?? "", /address/i);
  const ok = await book({ at: at(day, "10:00"), address: "10 Example Street, Toronto", ...base });
  assert.equal(ok.error, null, ok.error?.message);
  assert.equal(ok.data.status, "pending_approval");
  const { data: row } = await admin.from("bookings").select("customer_address, status").eq("id", ok.data.id).single();
  assert.equal(row.customer_address, "10 Example Street, Toronto");
  // a pending request still holds the time
  const clash = await book({ at: at(day, "10:30"), address: "x", ...base });
  assert.match(clash.error?.message ?? "", /taken|pick another/i);
});

test("a deposit service is confirmed straight away when payments aren't connected, held for payment when they are", async () => {
  const day = weekday(16);
  const colour = { params: { p_service: st.orgA.services.colour, p_member: st.orgA.members.sara } };
  const free = await book({ at: at(day, "09:00"), ...colour });
  assert.equal(free.data?.status, "confirmed", free.error?.message);
  await admin.from("organizations").update({ stripe_charges_enabled: true, stripe_account_id: "acct_e2e" }).eq("id", st.orgA.id);
  try {
    const paid = await book({ at: at(day, "13:00"), ...colour });
    assert.equal(paid.data?.status, "pending_payment", paid.error?.message);
    // the unpaid hold blocks the slot
    const clash = await book({ at: at(day, "13:30"), ...colour });
    assert.match(clash.error?.message ?? "", /taken|pick another/i);
  } finally {
    await admin.from("organizations").update({ stripe_charges_enabled: false, stripe_account_id: null }).eq("id", st.orgA.id);
  }
});

test("buffer time after a service blocks the next slot", async () => {
  const day = weekday(17);
  const colour = { params: { p_service: st.orgA.services.colour, p_member: st.orgA.members.sara } };
  assert.equal((await book({ at: at(day, "09:00"), ...colour })).error, null); // 09:00-11:00 + 15 min buffer
  const tooSoon = await book({ at: at(day, "11:00") }); // haircut right after
  assert.ok(tooSoon.error, "inside the 15 minute buffer");
  assert.equal((await book({ at: at(day, "11:15") })).error, null, "after the buffer is fine");
});

test("time off blocks booking", async () => {
  const day = weekday(18);
  const { error } = await admin.from("time_off").insert({ org_id: st.orgA.id, member_id: st.orgA.members.sara, starts_at: at(day, "12:00"), ends_at: at(day, "14:00"), reason: "e2e" });
  assert.equal(error, null, error?.message);
  const r = await book({ at: at(day, "13:00") });
  assert.ok(r.error); clean(r, "time off");
  assert.equal((await book({ at: at(day, "14:00") })).error, null);
});

test("manage page data: valid token works, bad tokens give nothing and no errors", async () => {
  const made = await book({ at: at(weekday(19), "10:00") });
  const ok = await pub.rpc("get_booking_by_token", { p_token: made.data.manage_token });
  assert.equal(ok.error, null);
  assert.equal(ok.data.status, "confirmed");
  for (const bad of ["", "x", "0".repeat(48), "'; drop table bookings;--", "a".repeat(5000), null]) {
    const r = await pub.rpc("get_booking_by_token", { p_token: bad });
    assert.equal(r.data ?? null, null, `token ${String(bad).slice(0, 12)}`);
  }
});

test("customers can reschedule within the allowed window, not into taken or impossible times", async () => {
  const day = weekday("resched");
  const colour = { params: { p_service: st.orgA.services.colour, p_member: st.orgA.members.sara } }; // only Sara does Colour
  const mine = await book({ at: at(day, "09:00"), ...colour });
  const other = await book({ at: at(day, "12:00"), ...colour });
  assert.equal(other.error, null, other.error?.message);
  const clash = await pub.rpc("reschedule_booking_by_token", { p_token: mine.data.manage_token, p_starts_at: at(day, "12:30") });
  assert.ok(clash.error, "moving onto someone else's booking must fail"); clean(clash, "reschedule clash");
  const closed = await pub.rpc("reschedule_booking_by_token", { p_token: mine.data.manage_token, p_starts_at: at(saturday(20), "10:00") });
  assert.ok(closed.error); clean(closed, "reschedule closed day");
  const moved = await pub.rpc("reschedule_booking_by_token", { p_token: mine.data.manage_token, p_starts_at: at(day, "15:00") });
  assert.equal(moved.error, null, moved.error?.message);
  const { data: row } = await admin.from("bookings").select("starts_at").eq("id", mine.data.id).single();
  assert.equal(new Date(row.starts_at).toISOString(), new Date(at(day, "15:00")).toISOString());
  const nope = await pub.rpc("reschedule_booking_by_token", { p_token: "0".repeat(48), p_starts_at: at(day, "15:00") });
  assert.ok(nope.error); clean(nope, "reschedule bad token");
});

test("rescheduling prefers the same person but may hand the booking to another eligible person", async () => {
  const day = weekday("handover");
  const mine = await book({ at: at(day, "10:00") }); // Haircut with Sara; Olivia also does haircuts
  assert.equal((await book({ at: at(day, "12:00") })).error, null); // Sara busy at 12:00
  const moved = await pub.rpc("reschedule_booking_by_token", { p_token: mine.data.manage_token, p_starts_at: at(day, "12:00") });
  assert.equal(moved.error, null, moved.error?.message);
  const { data: row } = await admin.from("bookings").select("member_id").eq("id", mine.data.id).single();
  assert.equal(row.member_id, st.orgA.members.olivia);
});

test("the cancel/reschedule cutoff is enforced for customers", async () => {
  await admin.from("organizations").update({ cancellation_window_hours: 48 }).eq("id", st.orgA.id);
  try {
    // a booking about 30 hours away is inside the 48 hour cutoff
    const soon = new Date(Date.now() + 30 * 3600_000);
    const day = weekday(1);
    const made = await admin.from("bookings").insert({
      org_id: st.orgA.id, member_id: st.orgA.members.sara, service_id: st.orgA.services.haircut, service_name: "Haircut",
      starts_at: soon.toISOString(), ends_at: new Date(soon.getTime() + 3600_000).toISOString(), blocked_until: new Date(soon.getTime() + 3600_000).toISOString(),
      status: "confirmed", price_cents: 8500, currency: "CAD", source: "manual",
    }).select("manage_token").single();
    assert.equal(made.error, null, made.error?.message);
    const c = await pub.rpc("cancel_booking_by_token", { p_token: made.data.manage_token, p_reason: "e2e" });
    assert.ok(c.error, "late cancellation refused"); clean(c, "late cancel");
    assert.match(c.error.message, /hour|contact|late|cancel/i);
    const rs = await pub.rpc("reschedule_booking_by_token", { p_token: made.data.manage_token, p_starts_at: at(day, "16:00") });
    assert.ok(rs.error, "late reschedule refused"); clean(rs, "late reschedule");
  } finally {
    await admin.from("organizations").update({ cancellation_window_hours: 24 }).eq("id", st.orgA.id);
  }
});

test("customers can cancel in time; cancelling twice or with a bad token is handled", async () => {
  const made = await book({ at: at(weekday(21), "10:00") });
  const c1 = await pub.rpc("cancel_booking_by_token", { p_token: made.data.manage_token, p_reason: "plans changed" });
  assert.equal(c1.error, null, c1.error?.message);
  const c2 = await pub.rpc("cancel_booking_by_token", { p_token: made.data.manage_token, p_reason: "again" });
  clean(c2, "cancel twice");
  const bad = await pub.rpc("cancel_booking_by_token", { p_token: "zzz", p_reason: "" });
  assert.ok(bad.error); clean(bad, "cancel bad token");
  // the freed slot can be booked again
  assert.equal((await book({ at: at(weekday(21), "10:00") })).error, null);
});

test("public data functions: unknown teams, odd input, and nothing private in the response", async () => {
  for (const slug of ["nope", "", "E2E-SALON", "e2e-salon ", "'; --", "a".repeat(500)]) {
    const r = await pub.rpc("get_public_org", { p_slug: slug });
    assert.ok(!r.error || !TECHNICAL.test(r.error.message), `slug ${slug.slice(0, 10)}: ${r.error?.message}`);
  }
  const org = (await pub.rpc("get_public_org", { p_slug: "e2e-salon" })).data;
  assert.ok(org?.org?.name);
  const text = JSON.stringify(org);
  assert.ok(!/stripe_account_id|sms_consent|manage_token|@tempo-e2e\.test/.test(text), "private fields leaked into the public booking page data");
  assert.ok(!org.services.some((s) => s.name === "Hidden service"), "hidden service is not public");
  assert.ok(org.services.every((s) => "auto_approve" in s));
});

test("anonymous visitors can't read or write the tables directly", async () => {
  for (const table of ["bookings", "customers", "memberships", "services", "organizations", "workflows", "message_log", "push_subscriptions", "invitations", "shifts"]) {
    const r = await pub.from(table).select("*").limit(1);
    assert.ok(r.error || (r.data ?? []).length === 0, `${table} readable by anonymous visitors`);
  }
  const w = await pub.from("services").insert({ org_id: st.orgA.id, name: "Hack", slug: "hack", duration_minutes: 10, price_cents: 0 });
  assert.ok(w.error, "anonymous insert must fail");
});
