import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatches, safeEqual } from "../src/lib/secure-compare";
import { DEFAULT_TIME_ZONE, MAX_OWNED_ORGS, formatDateLong } from "../src/lib/billing";

test("S-006: the cron bearer check is exact, constant-time and fails closed without a secret", () => {
  assert.equal(bearerMatches("Bearer s3cret", "s3cret"), true);
  assert.equal(bearerMatches("Bearer s3cre", "s3cret"), false);
  assert.equal(bearerMatches("Bearer s3cret2", "s3cret"), false);
  assert.equal(bearerMatches("bearer s3cret", "s3cret"), false);
  assert.equal(bearerMatches("s3cret", "s3cret"), false);
  assert.equal(bearerMatches(null, "s3cret"), false);
  assert.equal(bearerMatches("Bearer ", ""), false, "no secret configured: never authorised, even for an empty token");
  assert.equal(bearerMatches("Bearer undefined", undefined), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("a", "b"), false);
});

test("D-005: dates are pinned to a time zone, so the server and the browser print the same day", () => {
  const end = "2026-11-15T02:00:00.000Z"; // 9 pm on the 14th in Toronto
  assert.equal(formatDateLong(end, "America/Toronto"), formatDateLong(end, "America/Toronto"));
  assert.match(formatDateLong(end, "America/Toronto"), /14/);
  assert.match(formatDateLong(end, "America/Vancouver"), /14/);
  assert.match(formatDateLong(end, "Pacific/Auckland"), /15/);
  assert.equal(formatDateLong(end), formatDateLong(end, DEFAULT_TIME_ZONE), "defaults to Toronto");
  assert.equal(formatDateLong(end, "Not/AZone"), formatDateLong(end, DEFAULT_TIME_ZONE), "an unknown zone name falls back instead of throwing");
});

test("S-001: the team cap is a single constant (3), mirrored by private.max_owned_orgs() in the migration", async () => {
  assert.equal(MAX_OWNED_ORGS, 3);
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/20261101000000_subscription_billing.sql", import.meta.url), "utf8");
  assert.match(sql, /private\.max_owned_orgs\(\) returns int language sql immutable as \$\$ select 3; \$\$/);
});
