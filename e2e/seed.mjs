// Creates the baseline test world: two teams, several people, services, locations. Everything is tagged
// (slug "e2e-*", emails "@tempo-e2e.test") and removed by cleanup.mjs. Passwords are random and only written
// to e2e/.state.json (git-ignored).
import { admin, cleanup, createTeamFor, createUser, guard, signedIn, strongPassword, writeState } from "./lib.mjs";

guard();
console.log("cleaning previous test data…", await cleanup(), "team(s) removed");

const people = {};
for (const [key, name] of Object.entries({ ownerA: "olivia.owner", adminA: "adam.admin", staffA1: "sara.stylist", staffA2: "sam.therapist", ownerB: "bea.owner", stranger: "nora.nobody" })) {
  people[key] = await createUser(name, strongPassword());
}
const as = {};
for (const [k, p] of Object.entries(people)) as[k] = await signedIn(p.email, p.password);

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

// ---- Team A: a salon with two locations
const orgA = await createTeamFor(people.ownerA, { name: "E2E Salon", slug: "e2e-salon", timezone: "America/Toronto", displayName: "Olivia Owner" });
// Team A needs room for 4 people and 2 locations, which is more than a trial includes: give it a paid plan (3 extra
// locations, 2 staff packs). Team B stays on the trial. The plan is only ever written with the service role.
must(await admin.from("subscriptions").update({ status: "active", extra_locations: 3, staff_packs: 2, current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString() }).eq("org_id", orgA), "plan for A");
for (const [key, role, display] of [["adminA", "admin", "Adam Admin"], ["staffA1", "member", "Sara Stylist"], ["staffA2", "member", "Sam Therapist"]]) {
  const inv = must(await as.ownerA.from("invitations").insert({ org_id: orgA, email: people[key].email, role }).select("token").single(), `invite ${key}`);
  must(await as[key].rpc("accept_invitation", { p_token: inv.token, p_display_name: display }), `accept ${key}`);
}
const { data: members } = await admin.from("memberships").select("id, user_id, display_name, role").eq("org_id", orgA);
const mid = Object.fromEntries(members.map((m) => [m.display_name.split(" ")[0].toLowerCase(), m.id]));

const loc = {};
for (const [i, [key, name, address]] of [["qw", "Queen West", "214 Queen St W, Toronto"], ["le", "Leslieville", "1120 Queen St E, Toronto"]].entries()) {
  loc[key] = must(await as.ownerA.from("locations").insert({ org_id: orgA, name, address, position: i }).select("id").single(), `location ${key}`).id;
}
must(await as.ownerA.from("member_locations").insert([
  { location_id: loc.qw, member_id: mid.olivia }, { location_id: loc.le, member_id: mid.olivia },
  { location_id: loc.qw, member_id: mid.sara }, { location_id: loc.le, member_id: mid.sam },
]), "member_locations");

const svc = {};
const services = [
  ["haircut", { name: "Haircut", slug: "haircut", duration_minutes: 60, price_cents: 8500, color: "#007AFF", staff: ["olivia", "sara"] }],
  ["colour", { name: "Colour", slug: "colour", duration_minutes: 120, buffer_after_minutes: 15, price_cents: 18000, deposit_cents: 5000, color: "#FF9500", staff: ["sara"] }],
  ["consult", { name: "Video consult", slug: "consult", kind: "meeting", location_type: "video", location_detail: "https://meet.example.test/room", duration_minutes: 30, price_cents: 0, color: "#34C759", staff: [] }],
  ["homevisit", { name: "Home visit", slug: "home-visit", duration_minutes: 90, price_cents: 12000, address_mode: "required", auto_approve: false, color: "#AF52DE", staff: ["sam"] }],
  ["hidden", { name: "Hidden service", slug: "hidden", duration_minutes: 45, price_cents: 5000, active: false, color: "#8E8E93", staff: [] }],
];
for (const [i, [key, { staff, ...row }]] of services.entries()) {
  const created = must(await as.ownerA.from("services").insert({ org_id: orgA, position: i, ...row }).select("id").single(), `service ${key}`);
  svc[key] = created.id;
  if (staff.length) must(await as.ownerA.from("service_staff").insert(staff.map((s) => ({ service_id: created.id, member_id: mid[s] }))), `staff ${key}`);
}

// ---- Team B: a clinic that approves every request
const orgB = await createTeamFor(people.ownerB, { name: "E2E Clinic", slug: "e2e-clinic", timezone: "America/Vancouver", displayName: "Bea Owner" });
const physio = must(await as.ownerB.from("services").insert({ org_id: orgB, name: "Physio", slug: "physio", duration_minutes: 45, price_cents: 9000, auto_approve: false, color: "#FF2D55" }).select("id").single(), "service B");

writeState({
  people,
  orgA: { id: orgA, slug: "e2e-salon", members: mid, locations: loc, services: svc },
  orgB: { id: orgB, slug: "e2e-clinic", services: { physio: physio.id } },
});
console.log("seeded: teams e2e-salon, e2e-clinic; people:", Object.keys(people).join(", "));
