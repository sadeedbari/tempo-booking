import assert from "node:assert/strict";
import { test } from "node:test";
import { emailOnlyVariables, renderEmail, renderEmailBody, renderSubject, renderText, sampleVars, unknownVariables, VARIABLES } from "../src/lib/templates";
import { DEFAULT_WORKFLOWS, describeTrigger, STARTERS } from "../src/lib/workflow-defaults";
import { finalizeSms, OPT_OUT, smsInfo } from "../src/lib/sms";

const vars = { ...sampleVars() };

test("variables are swapped in, with or without spaces inside the braces", () => {
  assert.equal(renderText("Hi {{customer_first_name}}, see you {{ time }}.", vars), "Hi Ada, see you 9:00 AM.");
});

test("a line whose variables are all empty is dropped, so there are no blank labels", () => {
  const out = renderText("When: {{date_time}}\nWhere: {{location}}\nDeposit: {{deposit}}", { ...vars, location: "", deposit: "" });
  assert.equal(out, "When: Monday, October 12 at 9:00 AM");
});

test("a line with some text and one empty variable among filled ones is kept", () => {
  assert.equal(renderText("{{customer_first_name}} {{staff_name}}", { ...vars, staff_name: "" }), "Ada");
});

test("blank lines are collapsed and trimmed", () => {
  assert.equal(renderText("\n\nHi\n\n\n\nBye\n\n", vars), "Hi\n\nBye");
});

test("unknown variables are reported, not silently dropped", () => {
  assert.deepEqual(unknownVariables("Hi {{customer_first_name}} {{custmer_name}} {{ nope }}"), ["custmer_name", "nope"]);
  assert.deepEqual(emailOnlyVariables("Go {{manage_button}} or {{manage_link}}"), ["manage_button"]);
});

test("email html is escaped: customer-controlled text can't inject markup", () => {
  const html = renderEmailBody("Hi {{customer_name}}", { ...vars, customer_name: '<img src=x onerror="alert(1)">' });
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;img"));
});

test("template text that looks like html is escaped too", () => {
  const html = renderEmailBody("<script>alert(1)</script> hello", vars);
  assert.ok(!html.includes("<script>"));
});

test("links are clickable, trailing punctuation stays outside, buttons render as links", () => {
  const html = renderEmailBody("Manage: {{manage_link}}.\n\n{{manage_button}}", vars, "#123456");
  assert.match(html, /<a href="https:\/\/tempo\.sulosystems\.com\/booking\/example"[^>]*>https:\/\/tempo\.sulosystems\.com\/booking\/example<\/a>\./);
  assert.match(html, /background:#123456[^>]*>Manage booking<\/a>/);
});

test("a javascript: link can't sneak in through a variable", () => {
  const html = renderEmailBody("{{manage_button}}", { ...vars, manage_button: 'x" onclick="evil()' });
  assert.ok(!/onclick="evil/.test(html), html);
});

test("subject is a single line", () => {
  assert.equal(renderSubject("Hi {{customer_first_name}}\n{{service_name}}", vars), "Hi Ada Haircut & style");
});

test("every built-in workflow renders cleanly with sample data, and uses only real variables", () => {
  for (const wf of [...DEFAULT_WORKFLOWS, ...STARTERS]) {
    for (const s of wf.steps) {
      assert.deepEqual(unknownVariables(s.subject + s.body), [], wf.name);
      if (s.channel === "email") {
        const e = renderEmail({ subject: s.subject, body: s.body, vars, accent: "#007AFF", phone: "416-555-0199" });
        assert.ok(e.subject.length > 0 || wf.name === "New workflow");
        assert.ok(!/\{\{/.test(e.html + e.text), wf.name);
      } else {
        assert.deepEqual(emailOnlyVariables(s.body), [], wf.name);
        assert.ok(!/\{\{/.test(renderText(s.body, vars)));
      }
    }
  }
});

test("the built-in confirmation text matches the old wording and ends with the opt-out line", () => {
  const sms = DEFAULT_WORKFLOWS[0].steps.find((s) => s.channel === "sms")!;
  const text = finalizeSms(renderText(sms.body, vars));
  assert.match(text, /^Lumen Studio: Confirmed - Haircut & style, Monday, October 12 at 9:00 AM\. Manage: https:\/\//);
  assert.ok(text.endsWith(OPT_OUT));
});

test("finalizeSms adds the opt-out once, and swaps fancy punctuation for plain", () => {
  const dash = String.fromCharCode(0x2014);
  const t = finalizeSms(`Hello ${dash} see you`);
  assert.equal(t, `Hello - see you ${OPT_OUT}`);
  assert.equal(finalizeSms(t), t);
});

test("smsInfo counts segments: 160 / 153 for plain text, 70 / 67 once anything fancy is in", () => {
  assert.deepEqual(smsInfo("a".repeat(160)), { length: 160, segments: 1, unicode: false });
  assert.equal(smsInfo("a".repeat(161)).segments, 2);
  assert.equal(smsInfo("a".repeat(306)).segments, 2);
  assert.equal(smsInfo("a".repeat(307)).segments, 3);
  const accent = String.fromCharCode(0x263a);
  assert.deepEqual(smsInfo(accent + "a".repeat(69)), { length: 70, segments: 1, unicode: true });
  assert.equal(smsInfo(accent + "a".repeat(70)).segments, 2);
  assert.equal(smsInfo("{").length, 2); // extended characters count twice
  assert.equal(smsInfo("").segments, 0);
});

test("trigger descriptions read naturally", () => {
  assert.equal(describeTrigger("before_start", 1440), "1 day before the appointment");
  assert.equal(describeTrigger("before_start", 120), "2 hours before the appointment");
  assert.equal(describeTrigger("after_end", 90), "90 minutes after the appointment ends");
  assert.equal(describeTrigger("booking_confirmed", 0), "When a booking is confirmed");
});

test("there is a sample value for every variable", () => {
  assert.equal(Object.keys(sampleVars()).length, VARIABLES.length);
});
