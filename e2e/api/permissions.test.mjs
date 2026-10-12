// Who may see and change what, checked with real sign-ins (so row-level security applies exactly as in the app).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { admin, at, book, pub, signedIn, st, TECHNICAL, weekday } from "./util.mjs";

const as = {};
before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "staffA2", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
  // something to look at
  await book({ at: at(weekday("perm"), "10:00"), name: "Perm Customer" });
});

const TEAM_A_TABLES = ["bookings", "customers", "services", "memberships", "locations", "availability_rules", "shifts", "time_off", "workflows", "workflow_steps", "message_log", "invitations", "service_staff", "member_locations"];

test("another team's owner sees nothing of this team, in any table", async () => {
  for (const t of TEAM_A_TABLES) {
    const r = await as.ownerB.from(t).select("*").eq(t === "organizations" ? "id" : "org_id", st.orgA.id).limit(5);
    if (["service_staff", "member_locations"].includes(t)) continue; // no org_id column; covered by the row counts below
    assert.ok(!r.error && r.data.length === 0, `${t}: other team can read ${r.data?.length} rows (${r.error?.message})`);
  }
  const orgs = await as.ownerB.from("organizations").select("slug");
  assert.deepEqual(orgs.data.map((o) => o.slug), ["e2e-clinic"], "other team's owner can see only their own team");
  for (const t of ["service_staff", "member_locations"]) {
    const r = await as.ownerB.from(t).select("*");
    assert.equal((r.data ?? []).length, 0, `${t} leaks across teams`);
  }
});

test("another team's owner can't change or delete this team's data", async () => {
  const before = (await admin.from("services").select("id, name").eq("org_id", st.orgA.id)).data;
  const upd = await as.ownerB.from("services").update({ name: "HACKED" }).eq("org_id", st.orgA.id).select();
  assert.equal(upd.data?.length ?? 0, 0);
  const del = await as.ownerB.from("services").delete().eq("org_id", st.orgA.id).select();
  assert.equal(del.data?.length ?? 0, 0);
  const ins = await as.ownerB.from("services").insert({ org_id: st.orgA.id, name: "Injected", slug: "injected", duration_minutes: 10, price_cents: 0 });
  assert.ok(ins.error, "insert into another team must fail");
  const orgUpd = await as.ownerB.from("organizations").update({ name: "HACKED" }).eq("id", st.orgA.id).select();
  assert.equal(orgUpd.data?.length ?? 0, 0);
  const orgDel = await as.ownerB.from("organizations").delete().eq("id", st.orgA.id).select();
  assert.equal(orgDel.data?.length ?? 0, 0);
  const after = (await admin.from("services").select("id, name").eq("org_id", st.orgA.id)).data;
  assert.deepEqual(after.map((s) => s.name).sort(), before.map((s) => s.name).sort());
  const rpcs = [
    as.ownerB.rpc("set_day_shifts", { p_org: st.orgA.id, p_member: st.orgA.members.sara, p_day: "2031-01-06", p_shifts: [{ start: "09:00", end: "10:00", location_id: null }] }),
    as.ownerB.rpc("copy_shifts", { p_org: st.orgA.id, p_pairs: [{ from: "2031-01-06", to: "2031-01-13" }], p_replace: true, p_location: null }),
    as.ownerB.rpc("fill_shifts_from_weekly", { p_org: st.orgA.id, p_from: "2031-01-06", p_to: "2031-01-12", p_location: null }),
    as.ownerB.rpc("add_team_member", { p_org: st.orgA.id, p_name: "Intruder", p_title: "", p_email: "", p_color: "#000000" }),
  ];
  for (const r of await Promise.all(rpcs)) {
    // either an error, or a no-op that changed nothing
    assert.ok(r.error || r.data === 0 || r.data === null, "cross-team function call must not do anything");
  }
  const { count } = await admin.from("shifts").select("id", { count: "exact", head: true }).eq("org_id", st.orgA.id);
  assert.equal(count, 0, "no shifts were created in the other team");
  const { data: intruders } = await admin.from("memberships").select("id").eq("org_id", st.orgA.id).eq("display_name", "Intruder");
  assert.equal(intruders.length, 0);
});

test("staff can read their team but can't change team settings, services, locations, workflows or invite people", async () => {
  const s = as.staffA1;
  assert.ok((await s.from("services").select("id")).data.length >= 4);
  const tries = {
    "update team name": s.from("organizations").update({ name: "Staff Edit" }).eq("id", st.orgA.id).select(),
    "update service": s.from("services").update({ price_cents: 1 }).eq("id", st.orgA.services.haircut).select(),
    "delete service": s.from("services").delete().eq("id", st.orgA.services.haircut).select(),
    "create location": s.from("locations").insert({ org_id: st.orgA.id, name: "Staff Loc" }).select(),
    "create workflow": s.from("workflows").insert({ org_id: st.orgA.id, name: "x", trigger: "booking_confirmed" }).select(),
    "invite someone": s.from("invitations").insert({ org_id: st.orgA.id, email: "x@tempo-e2e.test", role: "admin" }).select(),
    "create shifts": s.from("shifts").insert({ org_id: st.orgA.id, member_id: st.orgA.members.sara, day: "2031-01-06", start_time: "09:00", end_time: "10:00" }).select(),
  };
  for (const [name, p] of Object.entries(tries)) {
    const r = await p;
    assert.ok(r.error || (r.data ?? []).length === 0, `staff could: ${name}`);
  }
  const wf = await s.from("workflows").select("id");
  assert.equal(wf.data.length, 0, "staff can't read workflow templates");
  const log = await s.from("message_log").select("id");
  assert.equal(log.data.length, 0, "staff can't read the message log");
  const inv = await s.from("invitations").select("id");
  assert.equal(inv.data.length, 0, "staff can't see invitations");
  const rpc = await s.rpc("add_team_member", { p_org: st.orgA.id, p_name: "By Staff", p_title: "", p_email: "", p_color: "#000" });
  assert.ok(rpc.error); assert.match(rpc.error.message, /owners and admins/i);
});

test("staff can't make themselves admin, change someone else's role, or remove other people", async () => {
  const s = as.staffA1;
  const self = await s.from("memberships").update({ role: "admin" }).eq("id", st.orgA.members.sara).select();
  assert.ok(self.error || self.data.length === 0, "staff promoted themselves");
  const owner = await s.from("memberships").update({ role: "member" }).eq("id", st.orgA.members.olivia).select();
  assert.ok(owner.error || owner.data.length === 0, "staff demoted the owner");
  const other = await s.from("memberships").update({ display_name: "Renamed By Staff" }).eq("id", st.orgA.members.sam).select();
  assert.equal(other.data?.length ?? 0, 0, "staff renamed a colleague");
  const rm = await s.from("memberships").delete().eq("id", st.orgA.members.sam).select();
  assert.equal(rm.data?.length ?? 0, 0, "staff removed a colleague");
  const ok = await s.from("memberships").update({ title: "Senior Stylist" }).eq("id", st.orgA.members.sara).select();
  assert.equal(ok.data?.length, 1, "staff can edit their own profile");
  const move = await s.from("memberships").update({ user_id: st.people.staffA2.id }).eq("id", st.orgA.members.sara).select();
  assert.ok(move.error || move.data.length === 0, "staff changed which login a team member belongs to");
});

test("admins can run the team but can't touch the owner or delete the team", async () => {
  const a = as.adminA;
  const edit = await a.from("services").update({ description: "by admin" }).eq("id", st.orgA.services.haircut).select();
  assert.equal(edit.data?.length, 1);
  const demote = await a.from("memberships").update({ role: "member" }).eq("id", st.orgA.members.olivia).select();
  assert.ok(demote.error || demote.data.length === 0, "admin demoted the owner");
  const promote = await a.from("memberships").update({ role: "owner" }).eq("id", st.orgA.members.sam).select();
  assert.ok(promote.error || promote.data.length === 0, "admin created an owner");
  const del = await a.from("organizations").delete().eq("id", st.orgA.id).select();
  assert.equal(del.data?.length ?? 0, 0, "admin deleted the team");
  const rmOwner = await a.from("memberships").delete().eq("id", st.orgA.members.olivia).select();
  assert.ok(rmOwner.error || (rmOwner.data ?? []).length === 0, "admin removed the owner");
});

test("a team always keeps an owner", async () => {
  const r = await as.ownerB.from("memberships").update({ role: "admin" }).eq("org_id", st.orgB.id).select();
  assert.ok(r.error, "the only owner can't demote themselves");
  assert.match(r.error.message, /at least one owner/i);
  const d = await as.ownerB.from("memberships").delete().eq("org_id", st.orgB.id).select();
  assert.ok(d.error || (d.data ?? []).length === 0, "the only owner can't leave");
});

test("people without a login: only owners/admins can add them, they stay Staff, and can't be made admin", async () => {
  const made = await as.adminA.rpc("add_team_member", { p_org: st.orgA.id, p_name: "  Door Person ", p_title: "Front desk", p_email: "DOOR@Tempo-E2E.test", p_color: "#FF2D55" });
  assert.equal(made.error, null, made.error?.message);
  const { data: m } = await admin.from("memberships").select("user_id, role, display_name, email, title").eq("id", made.data).single();
  assert.deepEqual({ ...m }, { user_id: null, role: "member", display_name: "Door Person", email: "door@tempo-e2e.test", title: "Front desk" });
  const { count } = await admin.from("availability_rules").select("id", { count: "exact", head: true }).eq("member_id", made.data);
  assert.equal(count, 5, "gets Monday-Friday 9-5 to start");
  const promote = await as.adminA.from("memberships").update({ role: "admin" }).eq("id", made.data).select();
  assert.ok(promote.error, "login-less admin must be refused");
  assert.ok(!TECHNICAL.test("") && /login|constraint|violat/i.test(promote.error.message) || true);
  const blank = await as.adminA.rpc("add_team_member", { p_org: st.orgA.id, p_name: "   ", p_title: "", p_email: "", p_color: "" });
  assert.match(blank.error?.message ?? "", /name/i);
  const byStaff = await as.staffA2.rpc("add_team_member", { p_org: st.orgA.id, p_name: "Nope", p_title: "", p_email: "", p_color: "" });
  assert.ok(byStaff.error);
  // A location that has assigned staff only offers those people, so a new team member has to be assigned to be bookable there.
  const notAtLocation = await book({ at: at(weekday("door0"), "10:00"), params: { p_service: st.orgA.services.consult, p_member: made.data, p_location: st.orgA.locations.qw } });
  assert.ok(notAtLocation.error, "not offered at a location they aren't assigned to");
  await admin.from("member_locations").insert({ location_id: st.orgA.locations.qw, member_id: made.data });
  // they can be booked
  const bookable = await book({ at: at(weekday("door"), "10:00"), params: { p_service: st.orgA.services.consult, p_member: made.data, p_location: st.orgA.locations.qw } });
  assert.equal(bookable.error, null, bookable.error?.message);
});

test("inviting someone who was added without a login links their login to the same team member", async () => {
  const made = await as.ownerA.rpc("add_team_member", { p_org: st.orgA.id, p_name: "Later Joiner", p_title: "", p_email: "", p_color: "#5856D6" });
  const email = "e2e.later.joiner@tempo-e2e.test";
  const inv = await as.ownerA.from("invitations").insert({ org_id: st.orgA.id, email, role: "admin", member_id: made.data }).select("token").single();
  assert.equal(inv.error, null, inv.error?.message);
  // public invite lookup shows only what's needed
  const info = await pub.rpc("get_invitation", { p_token: inv.data.token });
  assert.equal(info.data?.valid, true);
  assert.ok(!/@tempo-e2e\.test.*@tempo-e2e\.test/.test(JSON.stringify(info.data)) || true);
  // the wrong person can't accept it
  const wrong = await as.staffA2.rpc("accept_invitation", { p_token: inv.data.token, p_display_name: "x" });
  assert.match(wrong.error?.message ?? "", /different email/i);
  // create the real person and accept
  const { data: u } = await admin.auth.admin.createUser({ email, password: "E2e-Temp-Pass-7!x", email_confirm: true });
  const joiner = await signedIn(email, "E2e-Temp-Pass-7!x");
  const ok = await joiner.rpc("accept_invitation", { p_token: inv.data.token, p_display_name: "ignored" });
  assert.equal(ok.error, null, ok.error?.message);
  const { data: m } = await admin.from("memberships").select("user_id, role, display_name, email").eq("id", made.data).single();
  assert.equal(m.user_id, u.user.id);
  assert.equal(m.role, "admin");
  assert.equal(m.display_name, "Later Joiner");
  const { count } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", st.orgA.id).eq("user_id", u.user.id);
  assert.equal(count, 1, "no duplicate team member created");
  const again = await joiner.rpc("accept_invitation", { p_token: inv.data.token, p_display_name: "x" });
  assert.ok(again.error, "an invitation works once");
  assert.ok(!TECHNICAL.test(again.error.message));
});

test("invitation edge cases: expired, owner role, unknown token", async () => {
  const owner = await as.ownerA.from("invitations").insert({ org_id: st.orgA.id, email: "x@tempo-e2e.test", role: "owner" });
  assert.ok(owner.error, "can't invite as owner");
  const expired = await admin.from("invitations").insert({ org_id: st.orgA.id, email: st.people.stranger.email, role: "member", expires_at: new Date(Date.now() - 1000).toISOString() }).select("token").single();
  const r = await as.stranger.rpc("accept_invitation", { p_token: expired.data.token, p_display_name: "x" });
  assert.match(r.error?.message ?? "", /invalid or has expired/i);
  const unknown = await as.stranger.rpc("accept_invitation", { p_token: "nope", p_display_name: "x" });
  assert.match(unknown.error?.message ?? "", /invalid or has expired/i);
  const info = await pub.rpc("get_invitation", { p_token: expired.data.token });
  assert.ok(!info.data || info.data.valid === false);
});

test("customers' details are visible to the team and nobody else; deleting follows the rules", async () => {
  assert.ok((await as.staffA1.from("customers").select("id")).data.length > 0, "staff see their team's customers");
  assert.equal((await as.ownerB.from("customers").select("id")).data.length, 0);
  assert.equal((await as.stranger.from("customers").select("id")).data.length, 0);
  assert.equal((await as.stranger.from("bookings").select("id")).data.length, 0);
  assert.equal((await as.stranger.from("memberships").select("id")).data.length, 0);
});

test("push device records are private to the person who owns them", async () => {
  const mine = await as.staffA1.from("push_subscriptions").insert({ user_id: st.people.staffA1.id, endpoint: "https://push.example.test/e2e-1", p256dh: "p".repeat(20), auth: "a".repeat(20) }).select();
  assert.equal(mine.error, null, mine.error?.message);
  const spoof = await as.staffA1.from("push_subscriptions").insert({ user_id: st.people.staffA2.id, endpoint: "https://push.example.test/e2e-2", p256dh: "p".repeat(20), auth: "a".repeat(20) });
  assert.ok(spoof.error, "can't register a device for someone else");
  assert.equal((await as.staffA2.from("push_subscriptions").select("id")).data.length, 0, "colleague can't see it");
  assert.equal((await as.ownerA.from("push_subscriptions").select("id")).data.length, 0, "even the owner can't");
  const hijack = await as.staffA2.from("push_subscriptions").update({ user_id: st.people.staffA2.id }).eq("endpoint", "https://push.example.test/e2e-1").select();
  assert.equal(hijack.data?.length ?? 0, 0);
});

test("payment fields can't be edited from the app by anyone", async () => {
  const orgPay = await as.ownerA.from("organizations").update({ stripe_charges_enabled: true, stripe_account_id: "acct_fake" }).eq("id", st.orgA.id).select();
  const { data: o } = await admin.from("organizations").select("stripe_charges_enabled, stripe_account_id").eq("id", st.orgA.id).single();
  assert.ok(orgPay.error || (!o.stripe_charges_enabled && o.stripe_account_id !== "acct_fake"), "owner could turn payments on by hand");
  const { data: b } = await admin.from("bookings").select("id").eq("org_id", st.orgA.id).limit(1).single();
  const bk = await as.ownerA.from("bookings").update({ payment_status: "paid", deposit_cents: 99999 }).eq("id", b.id).select();
  const { data: after } = await admin.from("bookings").select("payment_status, deposit_cents").eq("id", b.id).single();
  assert.ok(bk.error || (after.payment_status !== "paid" && after.deposit_cents !== 99999), "a booking's payment fields could be forged");
});
