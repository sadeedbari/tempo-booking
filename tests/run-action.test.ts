import test from "node:test";
import assert from "node:assert/strict";
import { REQUEST_FAILED, SESSION_ENDED, isControlFlowError, runAction } from "../src/lib/run-action";

// D-020: a failed server action call becomes a value (inline message), never an uncaught throw that blanks the page.
test("a successful call passes its value through", async () => {
  assert.deepEqual(await runAction(async () => ({ ok: true })), { ok: true, value: { ok: true } });
});

test("a lost connection or HTTP 500 (the call throws) becomes the friendly message", async () => {
  const r = await runAction(async () => { throw new TypeError("Failed to fetch"); });
  assert.deepEqual(r, { ok: false, error: REQUEST_FAILED, sessionEnded: false });
  const r500 = await runAction(async () => { throw new Error("An unexpected response was received from the server."); }, async () => false);
  assert.deepEqual(r500, { ok: false, error: REQUEST_FAILED, sessionEnded: false });
});

test("the raw error text never reaches the message", async () => {
  const r = await runAction(async () => { throw new Error("sk_test_secret price_123"); });
  assert.ok(!r.ok && !/sk_test|price_/.test(r.error));
});

test("an ended session is reported as such", async () => {
  const r = await runAction(async () => { throw new Error("redirected to /login"); }, async () => true);
  assert.deepEqual(r, { ok: false, error: SESSION_ENDED, sessionEnded: true });
});

test("if the session check itself fails, it counts as a plain request failure", async () => {
  const r = await runAction(async () => { throw new Error("x"); }, async () => { throw new Error("offline"); });
  assert.deepEqual(r, { ok: false, error: REQUEST_FAILED, sessionEnded: false });
});

test("redirect() and notFound() control-flow errors are re-thrown, not swallowed", async () => {
  for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
    const err = Object.assign(new Error(digest), { digest });
    assert.equal(isControlFlowError(err), true);
    await assert.rejects(runAction(async () => { throw err; }), (e) => e === err);
  }
  assert.equal(isControlFlowError(new Error("plain")), false);
  assert.equal(isControlFlowError(null), false);
});

// D-024: submitForm keeps the browser from submitting natively (which React would answer by emptying the form) and hands over the FormData.
import { submitForm } from "../src/components/ui/use-server-action";
test("submitForm prevents the default submit and passes the form's FormData on", () => {
  let prevented = false;
  let got: unknown = null;
  const form = { tag: "form" };
  const orig = globalThis.FormData;
  // minimal stand-in: the helper only needs `new FormData(form)` to return something it can pass on
  (globalThis as { FormData: unknown }).FormData = class { constructor(public f: unknown) {} };
  try {
    submitForm((fd) => { got = fd; })({ preventDefault: () => { prevented = true; }, currentTarget: form } as never);
  } finally { (globalThis as { FormData: unknown }).FormData = orig; }
  assert.equal(prevented, true);
  assert.equal((got as { f: unknown }).f, form);
});

// D-029: the session-ended check applies only on signed-in surfaces.
import { isSignedInSurface, shouldCheckSession } from "../src/lib/run-action";
test("public pages never check the session, dashboard pages do", () => {
  for (const p of ["/e2e-salon", "/e2e-salon/contact", "/booking/abc", "/booking/abc/reschedule", "/waitlist/abc", "/embed/x", "/embed/x/contact", "/invite/abc", "/login", "/"]) assert.equal(isSignedInSurface(p), false, p);
  for (const p of ["/o/acme/customers", "/o/acme", "/onboarding", "/app"]) assert.equal(isSignedInSurface(p), true, p);
});
test("an explicit option beats the path", () => {
  assert.equal(shouldCheckSession(false, "/o/acme"), false);
  assert.equal(shouldCheckSession(true, "/booking/x"), true);
  assert.equal(shouldCheckSession(undefined, "/booking/x"), false);
  assert.equal(shouldCheckSession(undefined, "/o/acme/team"), true);
});
test("with no session check an anonymous failure stays a plain request failure", async () => {
  const r = await runAction(async () => { throw new TypeError("Failed to fetch"); }, undefined);
  assert.deepEqual(r, { ok: false, error: REQUEST_FAILED, sessionEnded: false });
});
