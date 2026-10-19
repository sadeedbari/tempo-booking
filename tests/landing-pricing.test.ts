import test from "node:test";
import assert from "node:assert/strict";
import { MAX_EXTRA_LOCATIONS, MAX_STAFF_PACKS, money, monthlyCents, planLimits } from "../src/lib/billing";
import { buildJsonLd } from "../src/components/marketing/json-ld";

// The landing page estimator maps "locations" (1+) and "extra staff packs" to a plan and prints these helpers' output.
const est = (locations: number, packs: number) => {
  const plan = { extraLocations: locations - 1, staffPacks: packs };
  return { total: money(monthlyCents(plan)), staff: planLimits(plan).staff, locations: planLimits(plan).locations };
};

test("estimator examples match the numbers on the landing page", () => {
  assert.deepEqual(est(1, 0), { total: "$15", staff: 5, locations: 1 });
  assert.deepEqual(est(2, 0), { total: "$30", staff: 10, locations: 2 });
  assert.deepEqual(est(2, 1), { total: "$35", staff: 15, locations: 2 });
  assert.deepEqual(est(3, 2), { total: "$55", staff: 25, locations: 3 });
});

test("estimator limits come from the billing limits", () => {
  assert.equal(monthlyCents({ extraLocations: MAX_EXTRA_LOCATIONS, staffPacks: MAX_STAFF_PACKS }), 1500 + 20 * 1500 + 40 * 500);
});

test("JSON-LD carries the real price in CAD and no ratings", () => {
  const s = JSON.stringify(buildJsonLd());
  const app = (buildJsonLd()["@graph"] as { "@type": string; offers?: { price: string; priceCurrency: string } }[]).find((n) => n["@type"] === "SoftwareApplication")!;
  assert.equal(app.offers!.price, "15");
  assert.equal(app.offers!.priceCurrency, "CAD");
  assert.doesNotMatch(s, /aggregateRating|review/);
});
