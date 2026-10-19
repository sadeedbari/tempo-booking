import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { friendlyZodMessage } from "@/lib/zod-message";

const msg = (schema: z.ZodType, v: unknown) => {
  const r = schema.safeParse(v);
  if (r.success) throw new Error("expected failure");
  return friendlyZodMessage(r.error);
};


test("replaces the library wording for a too-long text", () => {
    assert.equal(msg(z.object({ name: z.string().max(80) }), { name: "x".repeat(81) }), "Name must be 80 characters or fewer.");
});
test("keeps a message written on purpose", () => {
    assert.equal(msg(z.object({ name: z.string().min(1, "Give the service a name") }), { name: "" }), "Give the service a name");
});
test("words number limits and missing values plainly", () => {
    assert.equal(msg(z.object({ duration_minutes: z.number().max(720) }), { duration_minutes: 900 }), "Duration minutes must be 720 or less.");
    assert.equal(msg(z.object({ price: z.number() }), {}), "Please fill in price.");
    assert.equal(msg(z.object({ color: z.string().regex(/^#/) }), { color: "red" }), "Color isn't valid. Please check it and try again.");
});
test("never shows raw library text", () => {
    assert.doesNotMatch(msg(z.object({ kind: z.enum(["a", "b"]) }), { kind: "c" }), /Invalid|expected/i);
});
