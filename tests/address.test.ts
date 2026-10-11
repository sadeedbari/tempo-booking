import assert from "node:assert/strict";
import { test } from "node:test";
import { withUnit } from "../src/lib/address";

test("a bare unit number gets a Unit label", () => {
  assert.equal(withUnit("12 Main St, Toronto", "4B"), "Unit 4B, 12 Main St, Toronto");
  assert.equal(withUnit("12 Main St, Toronto", "  1204 "), "Unit 1204, 12 Main St, Toronto");
});

test("a unit that already says what it is is used as typed", () => {
  assert.equal(withUnit("12 Main St", "Apt 4B"), "Apt 4B, 12 Main St");
  assert.equal(withUnit("12 Main St", "suite 200"), "suite 200, 12 Main St");
  assert.equal(withUnit("12 Main St", "#12"), "#12, 12 Main St");
  assert.equal(withUnit("12 Main St", "Basement"), "Unit Basement, 12 Main St"); // free text still reads fine
});

test("no unit leaves the address alone; no address drops the unit", () => {
  assert.equal(withUnit("12 Main St", ""), "12 Main St");
  assert.equal(withUnit("12 Main St", null), "12 Main St");
  assert.equal(withUnit("", "4B"), "");
  assert.equal(withUnit(undefined, "4B"), "");
});

test("very long unit text is capped", () => {
  const r = withUnit("12 Main St", "x".repeat(100));
  assert.ok(r.length <= "Unit ".length + 30 + ", 12 Main St".length);
});
