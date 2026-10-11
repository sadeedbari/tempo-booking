import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone } from "../src/lib/phone";

test("North American numbers in any common format become +1XXXXXXXXXX", () => {
  for (const raw of ["416-555-1234", "(416) 555 1234", "416.555.1234", "4165551234", "1 416 555 1234", "+1 (416) 555-1234"]) {
    assert.equal(normalizePhone(raw, "CAD"), "+14165551234", raw);
  }
  assert.equal(normalizePhone("212 555 0100", "USD"), "+12125550100");
});

test("rejects numbers that can't be valid", () => {
  assert.equal(normalizePhone("", "CAD"), null);
  assert.equal(normalizePhone("555-1234", "CAD"), null); // no area code
  assert.equal(normalizePhone("041 655 5123 4", "CAD"), null); // area code can't start with 0
  assert.equal(normalizePhone("not a number", "CAD"), null);
  assert.equal(normalizePhone("+123", "CAD"), null); // too short
});

test("international numbers keep their country code", () => {
  assert.equal(normalizePhone("+44 20 7946 0958", "CAD"), "+442079460958");
  assert.equal(normalizePhone("0044 20 7946 0958", "USD"), "+442079460958");
});

test("other countries: trunk zero is dropped and the country code added", () => {
  assert.equal(normalizePhone("020 7946 0958", "GBP"), "+442079460958");
  assert.equal(normalizePhone("0412 345 678", "AUD"), "+61412345678");
});

test("without a known country, only the + form is accepted", () => {
  assert.equal(normalizePhone("0412 345 678", "EUR"), null);
  assert.equal(normalizePhone("+33 1 23 45 67 89", "EUR"), "+33123456789");
});
