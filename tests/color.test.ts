import test from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, readableOn } from "../src/lib/color";

const cases: [string, string][] = [
  ["#007AFF", "#000000"], // 4.02 with white, 5.23 with black
  ["#FF9500", "#000000"],
  ["#FFFFFF", "#000000"],
  ["#000000", "#FFFFFF"],
  ["#FFF176", "#000000"], // pale yellow
];
for (const [bg] of cases) {
  test(`readableOn(${bg}) reaches 4.5:1 or the best available`, () => {
    const fg = readableOn(bg);
    const other = fg === "#FFFFFF" ? "#000000" : "#FFFFFF";
    assert.ok(contrastRatio(bg, fg) >= contrastRatio(bg, other));
  });
}
test("expected choices", () => {
  assert.equal(readableOn("#007AFF"), "#000000");
  assert.equal(readableOn("#FF9500"), "#000000");
  assert.equal(readableOn("#FFFFFF"), "#000000");
  assert.equal(readableOn("#000000"), "#FFFFFF");
  assert.equal(readableOn("#FFF176"), "#000000");
});
test("contrast is at least 4.5:1 for non-mid colours", () => {
  for (const bg of ["#007AFF", "#FF9500", "#FFFFFF", "#000000", "#FFF176", "#808080"]) assert.ok(contrastRatio(bg, readableOn(bg)) >= 4.5, bg);
});
test("invalid input falls back safely", () => {
  for (const bad of ["", "red", "#12", "#GGGGGG", null, undefined]) assert.equal(readableOn(bad as string), readableOn("#007AFF"));
});
