// Intake questions: how answers are checked and stored when someone books, and who may edit the questions.
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { admin, at, pub, signedIn, st, TECHNICAL, unique, weekday } from "./util.mjs";

const as = {};
let svcId;
before(async () => {
  for (const k of ["ownerA", "adminA", "staffA1", "ownerB", "stranger"]) as[k] = await signedIn(st.people[k].email, st.people[k].password);
  // A service of its own, so these bookings never compete with other tests for a slot.
  const { data, error } = await admin.from("services").insert({ org_id: st.orgA.id, name: "Intake Test", slug: "intake-test", duration_minutes: 15, price_cents: 0, position: 99 }).select("id").single();
  assert.equal(error, null, error?.message);
  svcId = data.id;
});
after(async () => {
  await admin.from("services").delete().eq("id", svcId);
});

const SVC = () => svcId;
let slotNo = 0;

beforeEach(async () => {
  await admin.from("service_questions").delete().eq("org_id", st.orgA.id);
});

/** Adds questions to the Colour service; returns them keyed by a short name. */
async function addQuestions(defs) {
  const out = {};
  let position = 0;
  for (const [key, d] of Object.entries(defs)) {
    const { data, error } = await admin
      .from("service_questions")
      .insert({ org_id: st.orgA.id, service_id: SVC(), label: d.label ?? key, type: d.type, options: d.options ?? [], required: d.required ?? false, help_text: d.help ?? null, position: position++ })
      .select("id")
      .single();
    assert.equal(error, null, error?.message);
    out[key] = data.id;
  }
  return out;
}

/** A booking through the same public function the booking page uses. Each call gets its own day. */
function bookWith(answers, o = {}) {
  return pub.rpc("create_public_booking", {
    p_org: st.orgA.id,
    p_service: o.service ?? SVC(),
    p_member: st.orgA.members.sara,
    p_starts_at: at(weekday(`intake${++slotNo}`), "15:30"),
    p_name: "Intake Tester",
    p_email: `${unique("intake")}@customers.tempo-e2e.test`,
    p_phone: "",
    p_notes: "",
    p_location: st.orgA.locations.qw,
    p_address: "",
    ...(answers === undefined ? {} : { p_answers: answers }),
  });
}
const stored = async (id) => (await admin.from("bookings").select("answers, status").eq("id", id).single()).data;
const worded = (r, what) => {
  assert.ok(r.error, `${what}: should be refused`);
  assert.equal(r.error.code, "P0001", `${what}: should be a worded refusal, got ${r.error.code} ${r.error.message}`);
  assert.ok(!TECHNICAL.test(r.error.message), `${what}: technical words leaked: ${r.error.message}`);
};

test("answers of every type are stored as a snapshot, in the business's order, normalised", async () => {
  const q = await addQuestions({
    allergies: { label: "Any allergies?", type: "text" },
    notes: { label: "Tell us more", type: "paragraph" },
    skin: { label: "Skin type", type: "choice", options: ["Dry", "Oily", "Normal"] },
    areas: { label: "Areas", type: "multi", options: ["Face", "Neck", "Back"] },
    first: { label: "First visit?", type: "yes_no" },
    policy: { label: "I accept the policy", type: "agree", required: true },
    last: { label: "Last visit", type: "date" },
  });
  const r = await bookWith({
    [q.allergies]: "  peanuts  ", [q.notes]: "Line one\nLine two", [q.skin]: "Oily", [q.areas]: ["Back", "Face", "Face"],
    [q.first]: "yes", [q.policy]: "on", [q.last]: "2026-03-04",
  });
  assert.equal(r.error, null, r.error?.message);
  const b = await stored(r.data.id);
  assert.deepEqual(b.answers.map((a) => [a.label, a.type, a.value]), [
    ["Any allergies?", "text", "peanuts"],
    ["Tell us more", "paragraph", "Line one\nLine two"],
    ["Skin type", "choice", "Oily"],
    ["Areas", "multi", ["Face", "Back"]], // the business's order, no duplicates
    ["First visit?", "yes_no", "Yes"],
    ["I accept the policy", "agree", "Agreed"],
    ["Last visit", "date", "2026-03-04"],
  ]);
  assert.ok(b.answers.every((a) => /^[0-9a-f-]{36}$/.test(a.id)));
});

test("optional questions can be skipped; a service with no questions ignores answers; leaving p_answers out still works", async () => {
  const q = await addQuestions({ allergies: { type: "text" }, areas: { type: "multi", options: ["Face", "Neck"] } });
  const none = await bookWith({});
  assert.equal(none.error, null, none.error?.message);
  assert.equal((await stored(none.data.id)).answers, null);
  const omitted = await bookWith(undefined);
  assert.equal(omitted.error, null, omitted.error?.message);
  const partial = await bookWith({ [q.allergies]: "none" });
  assert.equal((await stored(partial.data.id)).answers.length, 1);
  // another service, no questions: answers sent anyway are dropped
  const other = await bookWith({ [q.allergies]: "ignored" }, { service: st.orgA.services.haircut });
  assert.equal(other.error, null, other.error?.message);
  assert.equal((await stored(other.data.id)).answers, null);
});

test("a missing required answer is refused in plain words and no booking is made", async () => {
  const q = await addQuestions({
    allergies: { label: "Any allergies?", type: "text", required: true },
    policy: { label: "I accept the cancellation policy", type: "agree", required: true },
    skin: { label: "Skin type", type: "choice", options: ["Dry", "Oily"], required: true },
    areas: { label: "Areas", type: "multi", options: ["Face", "Neck"], required: true },
    first: { label: "First visit?", type: "yes_no", required: true },
  });
  const before = (await admin.from("bookings").select("id", { count: "exact", head: true }).eq("service_id", SVC())).count;
  const full = { [q.allergies]: "none", [q.policy]: "on", [q.skin]: "Dry", [q.areas]: ["Face"], [q.first]: "no" };
  for (const key of Object.keys(full)) {
    const partial = { ...full };
    delete partial[key];
    const r = await bookWith(partial);
    worded(r, `missing ${key}`);
    assert.match(r.error.message, /answer|tick/i);
  }
  worded(await bookWith({ ...full, [q.allergies]: "   " }), "blank text");
  worded(await bookWith(null), "null answers");
  const after = (await admin.from("bookings").select("id", { count: "exact", head: true }).eq("service_id", SVC())).count;
  assert.equal(after, before, "a refused booking must not leave a booking behind");
  const ok = await bookWith(full);
  assert.equal(ok.error, null, ok.error?.message);
});

test("answers that don't fit the question are refused politely", async () => {
  const q = await addQuestions({
    skin: { label: "Skin type", type: "choice", options: ["Dry", "Oily"] },
    areas: { label: "Areas", type: "multi", options: ["Face", "Neck"] },
    first: { label: "First visit?", type: "yes_no" },
    last: { label: "Last visit", type: "date" },
  });
  worded(await bookWith({ [q.skin]: "Scaly" }), "choice not offered");
  worded(await bookWith({ [q.areas]: ["Face", "Toes"] }), "multi not offered");
  worded(await bookWith({ [q.first]: "maybe" }), "yes/no");
  worded(await bookWith({ [q.last]: "2026-02-31" }), "impossible date");
  worded(await bookWith({ [q.last]: "next tuesday" }), "date format");
  worded(await bookWith("just text"), "answers not an object");
  worded(await bookWith({ [q.skin]: "Dry", [q.last]: "x".repeat(40_000) }), "oversized");
});

test("long text is cut, wrong shapes for text are ignored, and made-up question ids are dropped", async () => {
  const q = await addQuestions({ short: { type: "text" }, long: { type: "paragraph" } });
  const r = await bookWith({ [q.short]: "s".repeat(1000), [q.long]: "l".repeat(5000), [crypto.randomUUID()]: "ghost", not_an_id: "x" });
  assert.equal(r.error, null, r.error?.message);
  const b = await stored(r.data.id);
  assert.equal(b.answers.length, 2);
  assert.equal(b.answers[0].value.length, 300);
  assert.equal(b.answers[1].value.length, 2000);
  const odd = await bookWith({ [q.short]: ["an", "array"], [q.long]: { a: 1 } });
  assert.equal(odd.error, null, odd.error?.message);
  assert.equal((await stored(odd.data.id)).answers, null);
});

test("rewording or deleting a question later never changes an old booking", async () => {
  const q = await addQuestions({ allergies: { label: "Any allergies?", type: "text" } });
  const r = await bookWith({ [q.allergies]: "shellfish" });
  await admin.from("service_questions").update({ label: "Something else entirely" }).eq("id", q.allergies);
  assert.equal((await stored(r.data.id)).answers[0].label, "Any allergies?");
  await admin.from("service_questions").delete().eq("id", q.allergies);
  const b = await stored(r.data.id);
  assert.deepEqual([b.answers[0].label, b.answers[0].value], ["Any allergies?", "shellfish"]);
});

test("the public booking data lists a service's questions in order, and only that service's", async () => {
  const q = await addQuestions({ a: { label: "First", type: "text" }, b: { label: "Second", type: "choice", options: ["x", "y"], required: true, help: "Pick" }, c: { label: "Third", type: "agree" } });
  const { data } = await pub.rpc("get_public_org", { p_slug: st.orgA.slug });
  const colour = data.services.find((s) => s.id === SVC());
  assert.ok(colour, "the test service should be bookable online");
  assert.deepEqual(colour.questions.map((x) => x.label), ["First", "Second", "Third"]);
  assert.deepEqual(Object.keys(colour.questions[1]).sort(), ["help_text", "id", "label", "options", "required", "type"]);
  assert.equal(colour.questions[1].required, true);
  assert.deepEqual(colour.questions[1].options, ["x", "y"]);
  assert.equal(colour.questions[1].help_text, "Pick");
  const haircut = data.services.find((s) => s.id === st.orgA.services.haircut);
  assert.deepEqual(haircut.questions, []);
  assert.ok(q.a);
});

test("who may see and change the questions", async () => {
  const q = await addQuestions({ a: { label: "Visible to the team", type: "text" } });
  // the team reads them; other teams and strangers don't; visitors can't read the table at all
  for (const who of ["ownerA", "adminA", "staffA1"]) {
    const r = await as[who].from("service_questions").select("id").eq("id", q.a);
    assert.equal(r.data?.length, 1, `${who} should see the question`);
  }
  for (const who of ["ownerB", "stranger"]) {
    const r = await as[who].from("service_questions").select("id").eq("org_id", st.orgA.id);
    assert.equal(r.data?.length ?? 0, 0, `${who} must not see them`);
  }
  assert.equal((await pub.from("service_questions").select("id")).data?.length ?? 0, 0);
  // owners and admins write; plain staff, other teams and visitors don't
  const row = (label) => ({ org_id: st.orgA.id, service_id: SVC(), label, type: "text" });
  assert.equal((await as.ownerA.from("service_questions").insert(row("by owner"))).error, null);
  assert.equal((await as.adminA.from("service_questions").insert(row("by admin"))).error, null);
  assert.ok((await as.staffA1.from("service_questions").insert(row("by staff"))).error, "staff must not add questions");
  assert.ok((await as.ownerB.from("service_questions").insert(row("by other team"))).error, "other team must not add questions");
  assert.ok((await pub.from("service_questions").insert(row("by visitor"))).error, "visitors must not add questions");
  for (const who of ["staffA1", "ownerB", "stranger"]) {
    const upd = await as[who].from("service_questions").update({ label: "HACKED" }).eq("id", q.a).select();
    assert.equal(upd.data?.length ?? 0, 0, `${who} must not edit`);
    const del = await as[who].from("service_questions").delete().eq("id", q.a).select();
    assert.equal(del.data?.length ?? 0, 0, `${who} must not delete`);
  }
  assert.equal((await admin.from("service_questions").select("label").eq("id", q.a).single()).data.label, "Visible to the team");
});

test("limits: 12 questions per service, a choice needs 2 to 12 options, labels are short", async () => {
  for (let i = 1; i <= 12; i++) await addQuestions({ [`q${i}`]: { label: `Question ${i}`, type: "text" } });
  const row = (o) => ({ org_id: st.orgA.id, service_id: SVC(), label: "Extra", type: "text", ...o });
  assert.ok((await admin.from("service_questions").insert(row())).error, "a 13th question must be refused");
  await admin.from("service_questions").delete().eq("org_id", st.orgA.id);
  assert.ok((await admin.from("service_questions").insert(row({ type: "choice", options: ["only one"] }))).error, "one choice is not a choice");
  assert.ok((await admin.from("service_questions").insert(row({ type: "multi", options: Array.from({ length: 13 }, (_, i) => `o${i}`) }))).error, "13 options is too many");
  assert.ok((await admin.from("service_questions").insert(row({ label: "x".repeat(201) }))).error, "label too long");
  assert.ok((await admin.from("service_questions").insert(row({ label: "" }))).error, "label empty");
  assert.ok((await admin.from("service_questions").insert(row({ type: "signature" }))).error, "unknown type");
});

test("deleting a service removes its questions too", async () => {
  const { data: svc } = await admin.from("services").insert({ org_id: st.orgA.id, name: "Temp", slug: `temp-${unique("s")}`, duration_minutes: 30, price_cents: 0 }).select("id").single();
  await admin.from("service_questions").insert({ org_id: st.orgA.id, service_id: svc.id, label: "Q", type: "text" });
  assert.equal((await admin.from("service_questions").select("id").eq("service_id", svc.id)).data.length, 1);
  await admin.from("services").delete().eq("id", svc.id);
  assert.equal((await admin.from("service_questions").select("id").eq("service_id", svc.id)).data.length, 0);
});

test("staff mode (used when the team adds a booking): blanks are fine, wrong answers are still refused, public roles can't call it", async () => {
  const q = await addQuestions({
    must: { label: "Must answer", type: "text", required: true },
    pick: { label: "Pick one", type: "choice", options: ["a", "b"] },
  });
  const call = (answers, enforce) => admin.rpc("build_intake_answers", { p_service: SVC(), p_answers: answers, ...(enforce === undefined ? {} : { p_enforce: enforce }) });
  // online (default and explicit): a missing required answer is refused
  assert.ok((await call({})).error, "default should enforce");
  assert.ok((await call({}, true)).error, "enforce=true should refuse");
  // the team: nothing required
  const blank = await call({}, false);
  assert.equal(blank.error, null, blank.error?.message);
  assert.equal(blank.data, null);
  const partial = await call({ [q.pick]: "b" }, false);
  assert.equal(partial.error, null);
  assert.deepEqual(partial.data.map((a) => a.value), ["b"]);
  // a wrong answer is still wrong
  assert.ok((await call({ [q.pick]: "zzz" }, false)).error, "an answer that isn't a choice must be refused");
  // not callable by visitors or signed-in people through the API
  assert.ok((await pub.rpc("build_intake_answers", { p_service: SVC(), p_answers: {} })).error, "anon must not call it");
  assert.ok((await as.ownerA.rpc("build_intake_answers", { p_service: SVC(), p_answers: {} })).error, "signed-in people must not call it directly");
});
