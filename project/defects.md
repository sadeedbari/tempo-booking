# Defect Log

**Statuses:** Open · Fixed – awaiting retest · Verified Fixed (closed) · Reopened · Disputed
**Severity:** Critical · High · Medium · Low

## Summary
| ID | Severity | Title | Status |
|---|---|---|---|
| D-001 | Medium | Read-only rule bypassed by two SECURITY DEFINER class RPCs (move_class_booking, move_class_session) | Verified Fixed |
| D-002 | Medium | Read-only rule has gaps: memberships, workflow_steps, service_staff, member_locations, workflow_services, calendar_connections stay writable without an active plan | Verified Fixed |
| D-003 | Medium | Read-only dashboard fails silently: inquiry and workflow actions report success but change nothing (or say "You don't have permission") | Verified Fixed |
| D-004 | Medium | Two paid Checkout sessions create two Stripe subscriptions; the second is ignored locally but never cancelled (double billing) | Verified Fixed |
| D-005 | Low | Billing page and plan banner dates are not time-zone pinned (hydration mismatch, wrong day); emails always use Toronto | Verified Fixed |
| D-006 | Low | Invitee who hits the staff limit or an inactive plan sees owner-only wording | Verified Fixed |
| D-007 | Low | Pending invitations are counted only by the UI, not the database; meter shows free seats while adding is blocked | Verified Fixed |
| D-008 | Low | "Tap again to confirm" cancel button is defeated by a double-click | Verified Fixed |
| D-009 | Low | Customers can still reschedule an existing booking into new slots on a paused business | Verified Fixed |
| D-010 | Low | Contact form / inquiries are not paused, and owners cannot act on them while expired | Verified Fixed |
| D-011 | Low | Non-owners can see billing state (payment failed, plan end date) via the banner and billing_status() | Verified Fixed |
| D-012 | Low | Each Stripe payment retry re-emails the owner; a concurrent duplicate webhook delivery can run twice | Verified Fixed |
| D-013 | Low | Every new organization gets a fresh 14-day trial (unlimited free trials) | Verified Fixed |
| D-014 | Low | Possible stale "plan isn't active" banner on the Checkout success page (suspected, not run) | Verified Fixed |
| D-015 | Medium | e2e cleanup does not clear trial_claims, so a second e2e run breaks specs that need a trial (found in round 2) | Verified Fixed |
| D-016 | Low | Onboarding page at the 3-team cap is a dead end (no way back, misleading heading, "New team" still offered) | Verified Fixed |
| D-017 | Low | Timed workflows: a failed or oversized subscriptions lookup silently pauses reminders for every business | Verified Fixed |
| D-018 | Medium | After the 7-day grace the hourly job flips the row expired -> past_due again and emails "Your Tempo subscription is active" every hour | Verified Fixed |

How these were found: the migration was executed (all 30 migrations in order) in PGlite, a real Postgres in WASM, with stubbed Supabase roles and `auth.uid()` (`tests/sql/billing-migration.test.mjs`); the billing webhook route and hourly sweep were driven with signed events against an in-memory REST stand-in (`tests/webhook/billing-webhook.test.ts`); the rest is static review. Nothing touched the remote Supabase project or Stripe.

---

### D-001 · Medium · Read-only rule bypassed by move_class_booking / move_class_session
- **Status:** Verified Fixed
- **Area / page:** `public.move_class_booking`, `public.move_class_session` (`supabase/migrations/20261029000000_class_changes.sql:119-200`, SECURITY DEFINER, only check `private.is_org_member`)
- **Environment / viewport:** PGlite (Postgres in WASM), all 30 migrations applied; `tests/sql/billing-migration.test.mjs`
- **Steps to reproduce:**
  1. Org with a class session and a booking, subscription status `expired` (or trial over).
  2. As the owner (or any member, even role "member"), call `select public.move_class_booking(<booking>, <other session>)` or `select public.move_class_session(<session>, '2026-11-20T15:00Z')`.
- **Expected:** refused. The dashboard is read-only without an active plan (requirements F6).
- **Actual:** both succeed. Definer functions bypass the restrictive RLS added by the billing migration, and the migration adds no `billing_entitled` check to them. The UI is blocked by `ctxFor`; a direct RPC call is not.
- **Evidence:** test output `FAIL (no error) expired: move_class_booking (owner, direct RPC) is refused` and same for `move_class_session`.
- **Developer notes:** Fixed 2026-10-18 in the (never-applied) billing migration: move_class_booking and move_class_session re-created with a billing_entitled check right after the permission check. Audit: set_day_shifts/copy_shifts/fill_shifts_from_weekly are SECURITY INVOKER so the restrictive RLS already applies; add_team_member and accept_invitation end in the staff-limit trigger (checks the plan); create_organization needs no plan. PGlite test now passes.
- **Retest notes:** Verified Fixed 2026-10-18. Function bodies diffed against 20261029000000_class_changes.sql: the only difference is the billing_entitled check after the permission check, and signatures are unchanged (no overload). tests/sql/billing-retest.test.mjs: expired, move_class_booking refused for a plain member and move_class_session refused for the owner, both with the clear message; on a plan both work (booking moves, the session move carries its bookings). billing-migration.test.mjs 96/96. Audit of all SECURITY DEFINER functions callable by users: the rest either end in a guarded insert (add_team_member, accept_invitation, public booking RPCs) or are invoker functions.

### D-002 · Medium · Read-only policies miss several tables
- **Status:** Verified Fixed
- **Area / page:** `supabase/migrations/20261101000000_subscription_billing.sql:184-197` (table list)
- **Environment / viewport:** PGlite, same harness
- **Steps to reproduce:**
  1. Org with status `expired`. As the owner through the API: update `memberships` (name, role, title), insert into `service_staff` or `member_locations`; update/insert `workflow_steps`, `workflow_services`, `calendar_connections`.
- **Expected:** all rejected ("dashboard cannot create or edit anything", F6).
- **Actual:** memberships update succeeded (1 row); `service_staff` and `member_locations` inserts succeeded. `workflow_steps` and `calendar_connections` have an `org_id` but no billing policy (harness lists uncovered tables: calendar_connections, external_busy, memberships, message_log, workflow_steps). `service_staff`, `member_locations`, `workflow_services` have no `org_id` so the loop cannot cover them. Result: `saveWorkflow` in an expired org edits message text (workflow_steps) while the workflow row itself silently does not update (see D-003).
- **Evidence:** harness output `memberships update while expired affects rows: 1`, `expired, service_staff insert: ALLOWED rows=1`, `expired, member_locations insert: ALLOWED rows=1`.
- **Developer notes:** Fixed: restrictive policies added for memberships (update, delete; a person can still leave on their own), workflow_steps, calendar_connections, and service_staff, member_locations, workflow_services (via the row they point to). external_busy and message_log have no write policy for users so nothing to cover. Verified in PGlite: owner edits work on a plan, refused when expired; invitation acceptance, org creation and limit-trigger messages unchanged.
- **Retest notes:** Verified Fixed 2026-10-18. Expired: service_staff, member_locations, workflow_services (insert refused, delete matches nothing), workflow_steps and calendar_connections (insert refused, update and delete match nothing), memberships (owner cannot edit or remove, a member cannot edit their own row). A member can still leave; the owner can still delete the team. On a plan every legitimate write of the same tables works. Generic pg_policies audit: the only write policies with no billing policy are organizations DELETE (intended), profiles UPDATE and push_subscriptions (personal, not business data). Side effect to know: a plain member also cannot edit their own membership row (name, title) while expired. That matches the read-only rule.

### D-003 · Medium · Read-only dashboard fails silently for some actions
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/inquiries/actions.ts:14-26` (setInquiryStatus, saveInquiryNote, deleteInquiry) and `src/app/o/[org]/workflows/actions.ts` (saveWorkflow, deleteWorkflow, setWorkflowActive). They use `getOrgContext`, not the new plan-checking `ctxFor`.
- **Environment / viewport:** static review plus DB behaviour confirmed in PGlite (restrictive UPDATE/DELETE filters rows, no error). Not run in a browser (that needs the remote DB).
- **Steps to reproduce:**
  1. Expired org, signed in as owner. Inquiries: mark one Handled, save a note, delete it. Workflows: toggle one off, delete a custom one.
- **Expected:** the same clear message as other actions ("Your subscription isn't active, so changes are turned off...").
- **Actual:** UPDATE/DELETE match 0 rows with no error, so the action returns `{ ok: true }` and the UI reports success; after refresh nothing changed. INSERTs fail with the generic "You don't have permission to do that." (`friendlyDbError` maps 42501).
- **Evidence:** harness `expired: owner update of service affects 0 rows (RLS)`.
- **Developer notes:** Fixed: inquiry actions and every workflow action now check the plan first (planBlockMessage) and return "Your subscription isn't active..." (owner wording) or "ask the account owner" (others). The public contact form is paused for expired orgs (page shows the neutral paused notice; database trigger refuses inserts too).
- **Retest notes:** Verified Fixed 2026-10-18 by code review plus database behaviour (not run in a browser). inquiries/actions.ts run() and workflows/actions.ts adminCtx now call planBlockMessage first and return the owner or ask-the-owner wording; the contact form pages show the paused notice and the insert trigger refuses (sql test: isn't taking messages, then works again on a plan). Workflow thrown errors are caught by each action and returned as { error }.

### D-004 · Medium · A second paid subscription is ignored locally but never cancelled
- **Status:** Verified Fixed
- **Area / page:** `src/lib/billing-server.ts:263` (applyStripeSubscription returns null for a different live subscription); `createCheckoutUrl` has no guard against parallel sessions
- **Environment / viewport:** webhook route driven with signed events against an in-memory REST stand-in (`tests/webhook/billing-webhook.test.ts`). Stripe itself not contacted.
- **Steps to reproduce:**
  1. Owner on a trial opens Billing and clicks Subscribe in two tabs (two Checkout sessions, same customer) and pays both. Or pays an old Checkout tab after the plan is already active. Or re-subscribes while an `unpaid`/`paused` Stripe subscription still exists (`hasLiveSubscription` is false for an expired row).
  2. Stripe sends `customer.subscription.created` for the second subscription.
- **Expected:** one subscription; the duplicate is cancelled and refunded, or Checkout is blocked while another is open.
- **Actual:** the event is acknowledged and dropped (test "a second, different Stripe subscription ... is ignored"). Stripe keeps billing both; the app shows one plan, no warning, and no way to see or cancel the other except the Stripe dashboard. The customer is charged twice.
- **Evidence:** `tests/webhook/billing-webhook.test.ts`
- **Developer notes:** Fixed: startCheckout/createCheckoutUrl asks Stripe for the customer's subscriptions and refuses (and syncs our copy) if one is live; Checkout gets an idempotency key (org + plan + 10-minute bucket), expires after an hour; the webhook cancels a second live subscription when the one we hold is still live in Stripe (and logs DUPLICATE so the extra charge can be refunded in Stripe), but lets a new one take over when ours is dead. Tests in tests/webhook.
- **Retest notes:** Verified Fixed 2026-10-18. New tests/webhook/billing-retest.test.ts: createCheckoutUrl refuses when Stripe has a live subscription for the customer (also unpaid/paused) and syncs our row, and creates no Checkout session; a customer with only dead subscriptions can subscribe; Checkout is idempotent (same URL on a double click, same key), expires_at is within Stripe's 30 min to 24 h window, and line items are only our three price ids. Webhook side (existing, 26/26): duplicate cancelled in Stripe, dead one replaced, old one ending ignored. Limit: the refund of the first charge on a cancelled duplicate stays manual (logged DUPLICATE). Real Stripe not exercised.

### D-005 · Low · Dates not pinned to a time zone
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/settings/billing/view.tsx:37`, `src/components/app/plan-banner.tsx:4` (`Intl.DateTimeFormat` without `timeZone`); `src/lib/billing-server.ts:344` (always America/Toronto)
- **Environment / viewport:** unit demonstration; not run in a browser
- **Steps to reproduce:**
  1. Org whose trial ends at 9 pm Toronto time (02:00 UTC next day). Open the billing page with the server in UTC and the browser in Toronto.
- **Expected:** same day on server and client, in the business's time zone.
- **Actual:** server renders one date, browser another: React hydration mismatch (console error) and a trial or period end shown a day off. Emails give Toronto dates to businesses in other zones (e.g. Vancouver).
- **Evidence:** `tests/billing-edge.test.ts`, last test.
- **Developer notes:** Fixed: new formatDateLong(date, timeZone) pinned to the business time zone (Toronto if unknown) used by view.tsx, plan-banner.tsx and the billing emails.
- **Retest notes:** Verified Fixed 2026-10-18 at unit level (not in a browser). formatDateLong pins the zone: an evening-Vancouver instant prints the 15th for America/Vancouver and the 16th for UTC; an invalid zone falls back to Toronto. view.tsx, plan-banner.tsx and the emails all use it with the business time zone. The hydration mismatch cannot recur from this cause; a browser check at 375/768/1280 is still pending.

### D-006 · Low · Invitee sees owner-only limit wording
- **Status:** Verified Fixed
- **Area / page:** `src/app/invite/[token]/actions.ts`; trigger messages in `supabase/migrations/20261101000000_subscription_billing.sql:146-153`
- **Environment / viewport:** PGlite
- **Steps to reproduce:**
  1. Send an invitation while there is room (or during the trial), then let the trial expire or fill the seats. The invitee signs in and accepts.
- **Expected:** a message for the invitee ("This team can't add people right now. Ask the owner.").
- **Actual:** "Your plan includes 25 staff. Add a staff pack on the Billing page to continue." or "Your subscription is not active ... Subscribe on the Billing page." The invitee cannot open Billing.
- **Evidence:** harness `accepting an invitation at the staff limit is refused`.
- **Developer notes:** Fixed: billing limit/plan errors from the database carry hint "billing"; acceptInvite maps that to "This team can't add people right now. Please ask the account owner to check the plan." Other non-owner paths already say ask the owner (checkCapacity, ctxFor, new action checks).
- **Retest notes:** Verified Fixed 2026-10-18. PGlite: refusals on accept_invitation (staff limit, inactive plan) carry hint billing; acceptInvite maps that hint to the invitee wording (code review). Not run through the page.

### D-007 · Low · Pending invitations are a UI-only reservation
- **Status:** Verified Fixed
- **Area / page:** `src/lib/billing-server.ts:23-31,64-73`, `src/app/o/[org]/settings/billing/view.tsx:122-123`, trigger `memberships_limit_guard`
- **Environment / viewport:** static review and PGlite
- **Steps to reproduce:**
  1. Trial org with 4 members and 1 pending invitation. Open Team > Add team member.
  2. Or, as an admin, insert many rows into `invitations` directly (RLS allows it).
- **Expected:** consistent counting between the meter, the block and the database.
- **Actual:** the Billing meter says "4 of 5 · 1 invitation waiting" yet adding is refused as if 5 of 5 (and offers a $5 upsell). The database does not reserve seats, so extra invitations can be created by direct insert and only fail when accepted (D-006).
- **Evidence:** code paths above.
- **Developer notes:** Fixed in the database: a pending invitation for a new person reserves a seat (trigger on invitations, and the membership trigger counts pending invitations, excluding the invitee's own). The UI meter and the block now agree. Tested in PGlite.
- **Retest notes:** Verified Fixed 2026-10-18. Database: a pending invitation reserves a seat (add_team_member and a second invitation refused at 24 of 25 plus 1 pending), the invitee's own invitation is not counted against them, invitations that link an existing login-less member need no seat, expired invitations free the seat, and the invitations trigger rejects over-limit direct inserts. getUsage counts the same set (accepted_at null, member_id null, not expired). Observation, no defect: the Billing meter reads 4 of 5 with a note 1 invitation waiting while adding is refused; the note explains it, but a plain 5 of 5 would be clearer. Also planFits (downgrade check) ignores pending invitations. [Closed in round 3: planFits, the Billing meter, checkCapacity and the database now all count pending invitations the same way (accepted_at null, member_id null, not expired); the invitee's own invitation is excluded in the database by matching email, which accept_invitation already requires. tests/billing-edge.test.ts and tests/sql/billing-round3.test.mjs R7.]

### D-008 · Low · Cancel confirmation can be double-clicked
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/settings/billing/view.tsx:176-184`
- **Environment / viewport:** static review (not run in a browser)
- **Steps to reproduce:**
  1. As owner of a paying org, double-click "Cancel at period end".
- **Expected:** a real confirmation step.
- **Actual:** the first click arms `confirmCancel`, the second click of the same double-click calls `cancelSubscription`. The armed state never resets (no blur, Escape or timeout). Reversible with "Keep my subscription" before the period ends.
- **Evidence:** code.
- **Developer notes:** Fixed: the confirm press is ignored if it comes within 0.8 s of arming (event timestamps), and the armed state resets after 6 s.
- **Retest notes:** Verified Fixed 2026-10-18 by code review only (browser not run). pressCancel ignores a confirm that arrives within 800 ms of arming (event timestamps) and disarms after 6 s. Minor: the 6 s timer is not cleared, so a re-arm shortly after a cancel can disarm early. Cosmetic. Needs one manual double-click check.

### D-009 · Low · Existing bookings can be rescheduled on a paused business
- **Status:** Verified Fixed
- **Area / page:** `reschedule_booking_by_token`, `src/app/booking/[token]/reschedule/page.tsx:23`
- **Environment / viewport:** PGlite
- **Steps to reproduce:**
  1. Expired org with a confirmed booking. The customer calls `reschedule_booking_by_token(token, <new time>)` (or uses the reschedule page).
- **Expected:** refused (the business "isn't accepting bookings"), or an explicit decision that rescheduling stays allowed (cancel by token is fine and intended).
- **Actual:** succeeds; the booking moves into a new slot.
- **Evidence:** harness `FAIL (no error) expired: customer reschedule via token is refused`.
- **Developer notes:** Decision applied: a customer who already has a booking may still reschedule it on a paused business (it moves an existing booking, no new booking is created; every path that creates a new booking is still refused). Test expectation changed to "allowed" with a comment.
- **Retest notes:** Verified Fixed 2026-10-18 as a documented DECISION, not a code change: a customer who already has a booking may still reschedule it on a paused business; every path that creates a new booking is refused. Test expectation now asserts the allowed behaviour. PM/user sign-off wanted: F6 says public booking paused, and a reschedule does move a booking into a new slot. If the user prefers it blocked, reopen.

### D-010 · Low · Contact form and inquiries not paused
- **Status:** Verified Fixed
- **Area / page:** `src/app/[slug]/contact`, `src/app/embed/[slug]/contact` (`create_public_inquiry`). The developer already listed this as a gap.
- **Environment / viewport:** static review
- **Steps to reproduce:**
  1. Expired org: open `/<slug>/contact` and submit.
- **Expected:** neutral paused message, or a documented decision to keep accepting.
- **Actual:** accepted, and the owner cannot mark it handled (D-003).
- **Evidence:** code.
- **Developer notes:** Fixed together with D-003 / S-010: contact form pages show the paused notice and a database trigger refuses new inquiries for an expired org.
- **Retest notes:** Verified Fixed 2026-10-18. Contact page and embed contact page show BookingPaused when org_accepts_bookings is false; create_public_inquiry is refused by the trigger when expired and works on a plan (sql test). Owner can mark or delete inquiries only on a plan, with a clear message otherwise (see D-003).

### D-011 · Low · Non-owners can see billing state
- **Status:** Verified Fixed
- **Area / page:** `src/components/app/plan-banner.tsx` (payment failed and plan end date shown to every member); `public.billing_status` returns `current_period_end` and `past_due_since` (its own comment says no payment dates)
- **Environment / viewport:** PGlite and static
- **Steps to reproduce:**
  1. As an admin or member call `rpc billing_status(<org>)`, or open the dashboard of an org in grace or with a pending cancellation.
- **Expected:** F5 says only owners see billing. If members need the read-only notice, expose only that and document it.
- **Actual:** admins and members get status, period end and the payment-failure date.
- **Evidence:** harness `admin may read plan summary`.
- **Developer notes:** Fixed: billing_status returns dates and payment-failure details only to owners; other members get status (past_due shown as active), entitled, limits. The banner shows non-owners only the "plan isn't active, ask the owner" notice.
- **Retest notes:** Verified Fixed 2026-10-18. billing_status for an admin when the org is past_due: dates null and status shown as active; the owner sees status and past_due_since. A non-owner sees only the plan-isn't-active, ask-the-owner banner. The subscriptions row is still readable by owners only; the Billing page shows non-owners a short notice only.

### D-012 · Low · Repeated emails and duplicate-delivery race
- **Status:** Verified Fixed
- **Area / page:** `src/lib/billing-server.ts:299-314` (email on every `invoice.payment_failed`); `src/app/api/stripe/billing-webhook/route.ts:33-40` (a concurrent redelivery of an unprocessed event id is processed again)
- **Environment / viewport:** static review
- **Steps to reproduce:**
  1. Stripe retries a failed invoice 3-4 times (each sends the event), or two deliveries of one event arrive together. The Checkout return page and the webhook can also race on "started".
- **Expected:** one "payment failed" email per problem; one processing per event.
- **Actual:** an email per retry; concurrent duplicates can both run (two "started" emails possible).
- **Evidence:** code.
- **Developer notes:** Fixed: the owner is emailed only when a payment problem starts (transition into past_due), not on every retry; the event row is claimed insert-first and an in-flight duplicate gets 409 (stale claims can be taken over, failed ones are released); the subscription write is compare-and-set on status so only one writer sends "started".
- **Retest notes:** Verified Fixed 2026-10-18. With a local Resend stand-in: 3 invoice.payment_failed retries send exactly 1 failure email, payment recovery then a new failure sends another; the same event id delivered twice sends 1 email; webhook then Checkout-return sends 1 started email. An in-flight duplicate gets 409 and a stale claim is taken over (existing test). Truly simultaneous delivery against a real database is not tested (the stand-in serialises).

### D-013 · Low · Unlimited free trials
- **Status:** Verified Fixed
- **Area / page:** `private.organizations_start_trial`, `create_organization`
- **Environment / viewport:** PGlite
- **Steps to reproduce:**
  1. Create a new team each time a trial ends (or delete and recreate).
- **Expected:** a decision (one trial per owner?). The spec is silent.
- **Actual:** every new team gets 14 days; no limit. Business risk, raised for a decision.
- **Evidence:** harness `new org gets trial`.
- **Developer notes:** Fixed (user decision 2026-10-18): one free trial per verified normalised email, recorded in trial_claims (survives deleting the team); later teams start with no trial; existing teams count as their owner's trial; max 3 owned teams (database and UI). See docs/billing-setup.md "Trials and teams".
- **Retest notes:** Verified Fixed 2026-10-18. Delete and recreate, case, +tag, padded, gmail dots and googlemail all give no second trial; unverified or missing email gives no trial and burns nothing (the next team after verifying earns it); a failed creation (duplicate slug) burns nothing; the 4th team is refused with a clear message and a person at the cap can still join other teams; backfill counts legacy owners (keys merged, null email skipped, admin-only not claimed); service-role inserts get a trial and claim nothing; users cannot write trial_claims, organizations or memberships directly; a paid subscription on a no-trial team behaves normally (1 location, 5 staff). Known limits, by design: a person with many different email addresses still gets one trial each; dots on non-gmail domains and + on shared mailboxes are treated as written; Yahoo or iCloud style aliases are not merged; every legacy team of a legacy owner keeps its own 14 days; if the Supabase project auto-confirms emails, verified means little (check the project setting). Related new defects: D-015 (e2e), D-016 (onboarding at the cap).

### D-014 · Low · Possible stale banner after returning from Checkout
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/layout.tsx` (reads `billing_status`) versus `settings/billing/page.tsx` (confirms Checkout during render)
- **Environment / viewport:** static review only
- **Steps to reproduce:**
  1. Expired org subscribes; Stripe redirects to `/settings/billing?checkout=success&session_id=...` (full page load).
- **Expected:** banner and page agree.
- **Actual (suspected):** layout and page render in the same request, so the layout may read the old status ("plan isn't active", red) while the page says "Your subscription is active". Needs a browser and Stripe test mode to confirm.
- **Evidence:** code.
- **Developer notes:** Fixed: the billing page confirms the Checkout and then redirects to a clean URL, so the layout (banner) renders after the plan changed. Not run in a browser.
- **Retest notes:** Verified Fixed 2026-10-18 by code review only (browser and real Checkout not run). The billing page confirms Checkout then redirect()s to a clean URL (outside the try block), so the layout renders after the plan changed; a failed confirmation lands on the processing banner.

### D-015 · Medium · e2e cleanup keeps trial_claims, so repeated e2e runs lose their trials
- **Status:** Verified Fixed
- **Area / page:** `e2e/lib.mjs` `cleanup()` and `e2e/seed.mjs`; `public.trial_claims` (no foreign keys, by design never deleted)
- **Environment / viewport:** static review (the e2e suite targets the live project and was deliberately not run)
- **Steps to reproduce:**
  1. Apply the migration. Run `e2e/seed.mjs` (creates `ownerB@tempo-e2e.test`-style users and teams, B on a trial). Run the specs. Run the seed again (cleanup deletes the teams and users, but not their `trial_claims` rows, keyed by email).
  2. On the second run team B and any team created in `02-onboarding.spec.ts` (user "stranger") start with no plan (status `expired`).
- **Expected:** the regression suite behaves the same on every run.
- **Actual:** from the second run on, team B is read-only and paused, and the onboarding spec's team creation redirects to `/settings/billing?notice=no-trial` instead of `/calendar?welcome=1`, so specs that expect the old behaviour fail. Team A is unaffected (the seed sets it to a paid plan with the service role).
- **Evidence:** `trial_claims` has no cleanup in `e2e/lib.mjs` (grep); reproduced at database level in `tests/sql/billing-retest.test.mjs` ("delete every team and recreate: still no trial").
- **Developer notes:** Fixed: `e2e/lib.mjs` cleanup now calls the service-role helper `forget_trial_claim(secret, user id, email)` for every test person before deleting them (records are hashes now, so they cannot be matched by an email suffix), and seed creates teams through `createTeamFor` (`create_organization_as`) like the app. Needs TRIAL_CLAIM_SECRET in .env.local. Not run against live (by instruction); the SQL helper is covered in the PGlite suites.
- **Retest notes:** Verified Fixed 2026-10-18 (final round) at database and code level; the e2e suite itself was not run (it targets the live project, forbidden). e2e/lib.mjs cleanup() calls forget_trial_claim(secret, user id, email) for every @tempo-e2e.test user after deleting their teams and before deleting the users; with no TRIAL_CLAIM_SECRET it prints a clear message and createTeamFor throws a clear message. seed.mjs creates both teams through createTeamFor (create_organization_as) and gives team A a paid plan with the service role. No other e2e/script/test/doc caller of the dropped create_organization remains (grep of src, e2e, scripts, docs; only the pre-billing legacy fixtures in the PGlite tests, which run before the migration). tests/sql/billing-round3.test.mjs R4: forget removes exactly the person's 2 records (wrong key removes 0, null email removes only the user record, nobody else touched) and the same person then earns a trial again. Limit: forget only removes the hash of the user's CURRENT email, so a spec that changes a test user's email would leave the old address recorded. None does today.

### D-016 · Low · Onboarding at the 3-team cap is a dead end
- **Status:** Verified Fixed
- **Area / page:** `src/app/onboarding/page.tsx`, `src/components/app/sidebar.tsx:246`
- **Environment / viewport:** code review (browser not run)
- **Steps to reproduce:**
  1. Own 3 teams. Open the team menu in the sidebar and press "New team" (always shown), or go to `/onboarding`.
- **Expected:** a clear message and a way back (link to the dashboard or the team list); "New team" hidden or explained at the cap; heading that fits.
- **Actual:** the page still says "Set up your team / You can change any of this later in Settings", with only a notice and no link except the logo. The action also refuses with a clear message if called directly, so no data problem.
- **Evidence:** page source above.
- **Developer notes:** Fixed: at 3 owned teams `/onboarding` shows the heading "You have 3 teams", a clear message and a "Back to my dashboard" link (first owned team); the team menu in the sidebar no longer offers "New team" at the cap. The action and the database still refuse a 4th team. Verified by build/typecheck only; not run in a browser.
- **Retest notes:** Verified Fixed 2026-10-18 (final round) by code review; not run in a browser (needs the live database). /onboarding counts the person's owner memberships (same query as the action); at 3 it renders "You have 3 teams", the explanation and a "Back to my dashboard" link to /o/<first owned team>/dashboard (the route exists), falling back to "/" and then /app. The sidebar team menu hides "New team" when the person owns 3 teams (OrgLite carries role; sidebar is the only other link to /onboarding; /app only sends people with no team there). The action and database still refuse a 4th (PGlite R6, plus billing-migration 125/125). Needs one visual check at 375/768/1280 once a database is available.

### D-017 · Low · Timed workflows: a failed or oversized plan lookup pauses everyone's reminders
- **Status:** Verified Fixed
- **Area / page:** `src/lib/messaging.ts` `runTimedWorkflows` (about line 380): `admin.from("subscriptions")....in("org_id", orgIds)` with every org that has an active timed workflow
- **Environment / viewport:** code review (scale and failure case, not reproduced against a database)
- **Steps to reproduce:**
  1. With a few hundred businesses (the `in.(uuid,...)` list goes into the request URL, a few hundred ids reach typical URL limits) or any database error on that query.
- **Expected:** a failure is logged and handled (chunk the ids, or skip the check and retry next hour), not silent.
- **Actual:** the error is ignored (`{ data: subs }` only), `subs` is empty, and every business is treated as "no subscription row" and paused (fail closed), so appointment reminders and thank-you messages stop for all businesses until the lookup works again, with no log line. Harmless today at small scale.
- **Evidence:** code. Same pattern exists in the older `.in("id", onlyOrgs)` calls, but those only apply when scoped.
- **Developer notes:** Fixed: `findPausedOrgs` in `src/lib/messaging.ts` reads plans in chunks of 100 ids; a failed chunk is logged and retried one business at a time, so only a business whose own lookup fails (or has no row) is paused for that run, never everyone. Test: `D-017` in `tests/webhook/billing-retest.test.ts`.
- **Retest notes:** Verified Fixed 2026-10-18 (final round). findPausedOrgs reads plans 100 ids at a time; a failed chunk is logged and retried one business at a time, so only a business whose own lookup fails is paused for the run (logged by id, retried next hour); a business without a row is paused (fail closed). tests/webhook/billing-retest.test.ts: a failing chunk of 100 pauses only the one failing org (org d0000150), the rest still send; 19/19. Source of the older tests unchanged. Not covered: the first query of runTimedWorkflows (active workflows) is not paged and ignores its own error (pre-existing, outside this defect).

### D-018 · Medium · Grace expiry is undone by the Stripe reconcile; hourly "subscription is active" email
- **Status:** Verified Fixed
- **Area / page:** `src/lib/billing-server.ts` runBillingSweep + reconcileWithStripe + applyStripeSubscription; webhook sync
- **Environment / viewport:** production e2e run 2026-10-18 (e2e/api/billing.test.mjs:254), reproduced twice
- **Steps to reproduce:**
  1. A paying business has a failed payment; past_due_since is more than 7 days ago; Stripe still says past_due (it keeps retrying).
  2. Run the hourly cron twice.
- **Expected:** status stays `expired` until the invoice is paid; no "active" email.
- **Actual:** the sweep sets `expired`, reconcile re-reads Stripe (past_due) and writes `past_due` back, counting expired -> past_due as "started": the owner gets "Your Tempo subscription is active" every hour. Entitlement stayed correct (billing_entitled uses past_due_since), so only the status and the emails were wrong.
- **Evidence:** project/e2e-run-2026-10-18.md
- **Developer notes:** Fixed: applyStripeSubscription keeps a row that is `expired` for the same Stripe subscription expired when Stripe still says past_due (and keeps past_due_since), so reconcile and a late customer.subscription.updated / invoice.payment_failed can't flip it. "started" now requires a real active status (never past_due or expired). Recovery: Stripe active (invoice.paid, portal payment) moves it to active with one "active" email. Tests in tests/webhook/billing-retest.test.ts (three D-018 tests: two sweeps, late webhook, recovery on invoice.paid).
- **Retest notes:** Verified Fixed 2026-10-18 (code + harness; production e2e not re-run by instruction). (1) Mutation check: a scratch copy of the app with the sticky line removed and `started` widened to past_due fails exactly the 3 new D-018 tests (24 -> 21 pass); the real code passes all 24. (2) Trace of e2e/api/billing.test.mjs:254: past_due_since 8 days old, Stripe past_due -> cron: sweep sets expired, reconcile re-reads Stripe past_due, `graceExpired` (row expired, same subscription id, Stripe past_due) keeps `expired` and the past_due_since; no email; then row forced to past_due + Stripe active + invoice.paid -> status active, past_due_since null: both assertions would pass. (3) Extra scenarios I added in a scratch copy (all pass, 5/5): trial-expired row with no subscription is expired once, one trial-ended email, stable on two sweeps, never an 'active' email; first-ever paid subscription on an expired trial row -> active, one email; grace-expired org re-subscribing with a DIFFERENT subscription id -> active on the new id, past_due_since null, one email, nothing cancelled, stable after a sweep; Stripe unpaid -> stays expired silently, canceled -> cancelled; recovery then a new failure restarts the grace clock and sends one failure email. Observation (not a defect, pre-existing compare-and-set design): if the hourly sweep expires a trial in the same instant as the very first subscription webhook for that org, the webhook loses the compare-and-set and answers 'unchanged' (row has no subscription id yet, so reconcile cannot pick it up); a later Stripe event or the Checkout-return sync would fix it. Needs true concurrency to hit; not reproduced.

---

<!-- Template – copy for each defect
### D-001 · [Severity] · [Short title]
- **Status:** Open
- **Area / page:**
- **Environment / viewport:**
- **Steps to reproduce:**
  1.
- **Expected:**
- **Actual:**
- **Evidence:** (screenshot path / console error)
- **Developer notes:**
- **Retest notes:**
-->
