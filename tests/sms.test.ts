import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSms, OPT_OUT } from "../src/lib/sms";

const base = {
  orgName: "Acme Detailing",
  serviceName: "Bronze Package",
  when: "Monday, October 14 at 2:00 PM",
  manageUrl: "https://tempo.sulosystems.com/booking/" + "a".repeat(48),
};

test("confirmation and reminder texts read correctly and end with the opt-out line", () => {
  const c = buildSms({ ...base, kind: "confirmation" });
  const r = buildSms({ ...base, kind: "reminder" });
  assert.match(c, /^Acme Detailing: Confirmed - Bronze Package, Monday, October 14 at 2:00 PM\. Manage: https:\/\/tempo\.sulosystems\.com\/booking\//);
  assert.match(r, /^Acme Detailing: Reminder - /);
  for (const m of [c, r]) assert.ok(m.endsWith(OPT_OUT), m);
  assert.equal(OPT_OUT, "Reply STOP to opt out.");
});

test("uses only plain ASCII so a message stays 160 characters per segment", () => {
  const m = buildSms({ ...base, kind: "confirmation" });
  assert.ok(/^[\x20-\x7e]*$/.test(m), "message contains characters outside plain ASCII");
});

test("a typical message fits in two segments", () => {
  const m = buildSms({ ...base, kind: "reminder" });
  assert.ok(m.length <= 306, `${m.length} characters`); // 2 x 153 (concatenated segments)
});

test("look-alike characters from the date formatter or business name are converted to plain ones", () => {
  const m = buildSms({
    ...base,
    kind: "reminder",
    orgName: "Joe’s Detailing", // curly apostrophe
    serviceName: "Full — Interior", // em dash
    when: "Monday, October 14 at 2:00 PM", // narrow no-break space, as newer ICU data emits
  });
  assert.ok(/^[\x20-\x7e]*$/.test(m), m);
  assert.match(m, /^Joe's Detailing: Reminder - Full - Interior, Monday, October 14 at 2:00 PM\./);
});
