Fixed (pending retest) |Fixed (pending retest) |Fixed (pending retest) |Fixed (pending retest) |Fixed (pending retest) |# Defect Log

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
| D-019 | Medium | Billing UI text and notices fail WCAG AA colour contrast (orange payment-failed strip 1.8:1, blue 3.2:1, red notice 2.9:1, hint text 2.4:1, white-on-blue button 4.0:1) | Verified Fixed |
| D-020 | Low | A failed request (lost connection, server 500) or an expired session on a billing button replaces the whole page with the generic error screen | Verified Fixed |
| D-021 | Low | Billing error and success messages are not announced to screen readers (no role=alert / live region) | Verified Fixed |
| D-022 | Low | Location editor "Bookable online" switch has no accessible name and the sheet dialogs have no accessible name (screens that carry the upgrade prompt) | Verified Fixed |
| D-023 | Low | "Your trial has ended." copy on the billing page can never be shown (dead branch); an ended trial reads "No active plan." | Verified Fixed |
| D-024 | Medium | A failed Save (lost connection / 500) shows the friendly message but empties the form the person had filled in (new service, team member, location) | Verified Fixed |
| D-025 | Medium | A lost connection or server error on Save in Customers, Time off and Contact form options replaces the whole page and loses what was typed | Verified Fixed (signed-in pages; public pages regressed, see D-029) |
| D-026 | Low | Form errors in sheets are not announced to screen readers, and a server validation error shows raw library text ("Too big: expected string to have <=80 characters") | Verified Fixed |
| D-027 | Low | At 200% text size the landing page header button and headline are cut off on phones | Verified Fixed |
| D-028 | Low | Landing page calendar illustration time labels fail text contrast (3.6 to 3.75:1); Lighthouse accessibility 96 | Verified Fixed |
| D-029 | High | A failed request (lost connection / HTTP 500) on a PUBLIC page sends the customer to the staff sign-in page (booking flow, cancel, reschedule, contact form, waitlist leave) and loses what they typed | Verified Fixed |
| D-030 | Low | Booking pages declare a large Twitter card but have no og:image / twitter:image (the site default image is dropped) | Verified Fixed |
| D-031 | Low | Toast messages (including error toasts) are not announced to screen readers | Verified Fixed |
| D-032 | Low | Booking flow: Back from the details step forgets the chosen day (calendar jumps to the first open day) | Verified Fixed |
| D-033 | Low | Landing page at 320px and 200% text: the FAQ open/close arrow is cut off for two questions | Verified Fixed |
| D-034 | Low | Landing page at 200% text: the sticky header takes 25 to 42% of a phone screen | Verified Fixed |
| D-035 | Low | Booking page title, description, canonical and robots are streamed into the body for normal browsers and Googlebot; Lighthouse reports no meta description (SEO 91) | Verified Fixed |
| D-036 | Low | Booking page text fails contrast in dark appearance (4.23:1 and 3.25:1); Lighthouse accessibility 95 | Verified Fixed |
| D-037 | Low | Selected day and time chips on the booking page are white on blue at 4.02:1 (not 4.5:1) | Verified Fixed |
| D-038 | Low | Dashboard text fails contrast outside the billing page (axe: sidebar, small grey text, white on blue buttons) | Open |
| D-039 | Low | Dark theme, default blue business colour: logo initial (3.16:1) and 'any person' icon (3.51:1) are below 4.5:1 (they meet 3:1 for large text and graphics) | Open |

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

### D-019 · Medium · Billing UI colours fail WCAG AA contrast (the orange payment-failed strip is 1.8:1)
- **Status:** Verified Fixed
- **Area / page:** `src/components/app/plan-banner.tsx:35` (strip colours), `src/components/ui/misc.tsx:116-119` (`Notice`), `src/app/globals.css:22-37` (`--label-3`, `--orange`, `--red`, `--accent`), `src/app/o/[org]/settings/billing/view.tsx:143,181` (`text-label-3` help text), `src/components/ui/button-class.ts` (filled button)
- **Environment / viewport:** production Supabase + mock Stripe, local build, Chrome, 1280px and 375px, light mode. axe-core (installed in a scratch folder outside the repo) reports `color-contrast` (serious) on 17 elements of the trial page, 16 of an active plan and 18 of an expired plan at 375px; the paused booking page has no violations.
- **Steps to reproduce:**
  1. Run `E2E_ALLOW_LIVE=1 npx playwright test e2e/specs/24-billing-roles-banner.spec.ts -g "D-019"` and `e2e/specs/29-billing-a11y.spec.ts -g "D-019"` (they print the ratios), or open the dashboard of an owner whose last payment failed (or whose trial has 3 days or fewer left), and the Billing page of a team on a trial, expired or active plan.
  2. Measure text colour against what is painted behind it (computed from the real CSS values; translucent tints are blended over the page background).
- **Expected:** WCAG 2.1 AA (requirements section 6): at least 4.5:1 for normal text (14px semibold is not "large text").
- **Actual:** plan strip: orange (trial last 3 days, payment failed) 1.81:1, blue (trial) 3.24:1, red (plan not active) 2.86:1. Billing page: help text and field hints (`label-3`) 2.43:1, red Notice and the "Expired" badge 3.10:1, "Subscribe for $..." white on `#007AFF` 4.02:1. The strip that warns about a failed payment is the hardest to read. The paused public page passes (heading 16.8:1, explanation 4.77:1). Dark mode not measured. The colours come from shared design tokens, so other pages that use `Notice` and `label-3` are affected too; billing is where the warning strips are.
- **Evidence:** spec output `strip contrast ratios: {"blue":3.24,"orange":1.81,"orange-past-due":1.81,"red":2.86}` and `billing page contrast ratios: {"usage footnote (label-3)":2.43,"field hint":2.43,"status line (label-2)":4.77,"red notice":3.10,"Subscribe button":4.02,"Expired badge":3.10}`; screenshots `test-results/24-billing-roles-banner-pl-*/test-failed-1.png`, `test-results/29-billing-a11y-D-019-*/test-failed-1.png` (git-ignored).
- **Developer notes:** Fixed (pending retest). New AA text tokens in globals.css (--accent-text, --orange-text, --red-text, --green-text, --accent-fill[-hover]; light and dark) used by Notice, Badge, the plan strip, the filled/tinted/plain/destructive buttons and the login notices; billing hints, footnotes and Field hints use label-2 instead of label-3; usage bars use the AA colours; strip keeps a different icon per state (Info / AlertTriangle / Ban) plus its text. Ratios (light, on card/canvas): blue 5.46/5.04, orange 6.21/5.76, red 5.81/5.36, green 5.59/5.19, label-2 4.74/4.53, white on Subscribe 5.80 (hover 7.12); dark: 5.81..8.55, button 5.61. tests/contrast.test.ts reads the tokens from globals.css and asserts every pair in light and dark.
- **Retest notes:** Verified Fixed 2026-10-19 (production Supabase + mock Stripe, local build, Chrome). Measured from computed styles. Light: strip blue/orange/red 5.01/5.76/5.35, orange also on payment-failed; billing hints and footnote 4.77, status line 4.77, red notice and Expired badge 5.80, Subscribe / Update plan / New service filled buttons 5.80, Active badge 5.61. Dark (emulated): strip 8.42/8.42/7.05, hints 6.90, red notice 5.45, filled buttons 5.61, Active badge 6.37; text inside a dark sheet 15.6 (input) / 12.8 (select). All >= 4.5. Specs 24 'D-019', 29 'D-019' and 30 pass. Note: spec 29 asserted the old text 'No active plan.' for an ended trial, so it timed out; changed to 'Your trial has ended.' (stale expectation, see D-023).

### D-020 · Low · A failed request on a billing button replaces the page with the generic error screen
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/settings/billing/view.tsx:79-87` (`go()` awaits the server action with no try/catch), same pattern in `src/components/app/upgrade-notice.tsx:29-35`; the error screen is `src/app/error.tsx`
- **Environment / viewport:** production Supabase + mock Stripe, local build, Chrome, 1280px
- **Steps to reproduce:**
  1. Sign in as the owner of a team on a trial and open Settings > Billing.
  2. Make the next server action fail: (a) drop the request (Playwright `route.abort`), (b) answer it with HTTP 500, or (c) end the session (clear cookies) after the page loaded.
  3. Press "Subscribe for $15/month".
- **Expected:** a short inline message in the page ("Something went wrong. Please try again."), the button usable again; for an ended session, the sign-in page.
- **Actual:** the whole page is replaced by "Something went wrong. We hit a problem loading this page" with "Try again" and "Go to my dashboard" (no billing page, no inline message). Nothing is charged and no data is lost, "Try again" recovers. The same happens for any other server action in the app (checked: Save on a new service after the session ended), so this is an app-wide pattern that the billing buttons inherit; the billing buttons are where a person is about to pay.
- **Evidence:** `e2e/specs/28-billing-errors.spec.ts`, the three "D-020" tests; screenshot `test-results/28-billing-errors-the-conn-*/test-failed-1.png` (git-ignored).
- **Developer notes:** Fixed (pending retest). New src/lib/run-action.ts (runAction turns a thrown/network error into a value, re-throws redirect()/notFound() digests) and src/components/ui/use-server-action.ts (useServerAction for result-handling buttons, useSafeTransition as a drop-in for useTransition). Billing buttons and the upgrade prompt show the inline message in a live region and re-enable; if the browser session is gone (supabase getUser) the person goes to /login?error=session&next=... which now says "Your session has ended. Please sign in again to continue.". Also applied to new/edit service, locations, team member sheets, settings and new session sheet (they already had an inline error line). Other useTransition call sites (about 25, e.g. customers, availability, workflows, booking sheets) still use plain useTransition: swapping them is the same one-line change. tests/run-action.test.ts.
- **Retest notes:** Verified Fixed 2026-10-19. Billing Subscribe with the request aborted and with HTTP 500: inline 'Something went wrong. Please check your connection and try again.' in role=alert, billing page still shown, Subscribe enabled, pressing it again reaches the stand-in Checkout. New-service Save, same two failures: message inside the sheet, sheet stays, Save enabled again, saving afterwards works. Ended session (cookies cleared) on Subscribe, on New service Save and on Manage billing: lands on /login?error=session with 'Your session has ended. Please sign in again to continue.' (role=status), no Stripe call. /login without the parameter shows no message. Specs 28 (14/14) and 30 pass. A side effect of the fix is logged as D-024.

### D-021 · Low · Billing messages are not announced to screen readers
- **Status:** Verified Fixed
- **Area / page:** `src/components/ui/misc.tsx:116-119` (`Notice` is a plain `div`), used for the billing page's error line (`view.tsx:164`), the plan-does-not-fit reason (`view.tsx:163`) and the success / processing / cancelled banners (`view.tsx:93-96`)
- **Environment / viewport:** local build, Chrome, any width
- **Steps to reproduce:**
  1. Make Stripe fail and press "Subscribe".
  2. Inspect the message "Something went wrong with billing. Please try again in a moment.".
- **Expected:** the message is in a live region (`role="alert"` for errors, `role="status"` for success), like the upgrade prompt (`upgrade-notice.tsx:21`, which has `role="alert"`) and the plan strip (`role="status"`).
- **Actual:** no `role` and no `aria-live` on the message or any ancestor, so a screen-reader user pressing Subscribe hears nothing when it fails. Also: after pressing "Update plan" with the keyboard the button becomes disabled and focus drops to the page body.
- **Evidence:** `e2e/specs/29-billing-a11y.spec.ts`, test "D-021 error messages on the billing page are announced".
- **Developer notes:** Fixed (pending retest). Notice gained an opt-in `live` prop (role=alert for red, role=status otherwise); billing error, plan-does-not-fit reason and success/processing/cancelled/no-trial banners use it; the upgrade prompt already had role=alert and its fallback Notice now does too; the plan strip is role=status and the paused page keeps its status region. Focus after pressing Update plan (button disabled) is not changed.
- **Retest notes:** Verified Fixed 2026-10-19. A failed Subscribe puts 'Something went wrong with billing...' in a role=alert; a failed request message is in role=alert; the plan strip and the cancelled/success banners are role=status; session-ended message on login is role=status. Specs 29 and 30 pass. Not checked with a real screen reader (DOM roles only). Focus still drops to the body after pressing the disabled Update plan button (developer left it; not re-checked).

### D-022 · Low · Unnamed switch and unnamed dialogs on the screens that show the upgrade prompt
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/settings/locations.tsx:140` (`<Switch name="active" .../>` for "Bookable online" has no `label`, so `aria-label` is empty), `src/components/ui/sheet.tsx:43` (`role="dialog" aria-modal` with no `aria-label` / `aria-labelledby`; the title is a plain `h2`); the "Takes bookings" switch in the member sheet (`team/view.tsx`) is the same
- **Environment / viewport:** local build, Chrome, 1280px
- **Steps to reproduce:**
  1. Owner opens Settings and presses "Add" in Locations.
  2. Inspect the switch next to "Bookable online" and the `role="dialog"` element.
- **Expected:** the switch is named (e.g. `label="Bookable online"`) and the dialog is named by its title.
- **Actual:** the switch is announced only as "switch, on" with no name; the dialog has no accessible name. (The "Invite them to sign in" switch in the Add team member sheet is named correctly.) The shared `Sheet` is used app-wide, so this is not specific to billing; it is on the screens where the upgrade prompt appears.
- **Evidence:** `e2e/specs/29-billing-a11y.spec.ts`, test "D-022 ...".
- **Developer notes:** Fixed (pending retest). Switch labels added: Bookable online (location editor and service editor), Takes bookings (member sheet), Send confirmation (new booking sheet), All day, Use this schedule for online booking. Sheet is now role=dialog aria-modal named by its title (aria-labelledby), moves focus in on open (unless a field already has autoFocus), traps Tab/Shift+Tab, and returns focus to the opener on close.
- **Retest notes:** Verified Fixed 2026-10-19. New service, Add team member, Add location and New booking sheets: role=dialog aria-modal named by its title; every switch in them has a name; focus moves in on open; 40 Tab and 40 Shift+Tab presses never leave the sheet; Escape closes and focus returns to the opener button; the X button closes and returns focus too. Typing right after opening goes into the autofocus Name field (unicode and emoji kept). Specs 29 and 30 pass. Note: the Add-member sheet title is 'Add a team member'.

### D-023 · Low · "Your trial has ended." can never be shown
- **Status:** Verified Fixed
- **Area / page:** `src/app/o/[org]/settings/billing/view.tsx:110` and `page.tsx:59` (the page passes `effectiveStatus()`, which turns an ended trial into `expired`, so the `sub.status === "trial"` branch that prints "Your trial has ended." is never reached)
- **Environment / viewport:** local build, Chrome, 1280px
- **Steps to reproduce:**
  1. Put a team on a trial that ended yesterday (or let one expire) and open Settings > Billing as the owner.
- **Expected:** the summary card says "Your trial has ended." (the wording the code was written for).
- **Actual:** the card shows "1 location, 5 staff", the red "Expired" badge and "No active plan." Nothing is wrong or unclear for the person (the red notice below explains the paused page and the read-only dashboard); it is dead copy.
- **Evidence:** `e2e/specs/23-billing-page-owner.spec.ts` ("a team with no trial and no plan ...") asserts the text that actually shows.
- **Developer notes:** Fixed (pending retest). New pure trialEnded() in src/lib/billing.ts (trial past its end, or expired with no Stripe subscription whose trial_ended_email_sent_at is empty or later than trial_ends_at); a second team created without a trial has both timestamps equal (set by private.organizations_start_trial), so it keeps "No active plan.". Billing page passes trialEnded and prints "Your trial has ended.". No migration needed. tests/billing-trial-ended.test.ts. The dashboard strip text is unchanged (it cannot see the trial fields without changing the billing_status RPC).
- **Retest notes:** Verified Fixed 2026-10-19. Billing page says 'Your trial has ended.' for an ended trial not yet swept, for an expired row swept by the hourly job (email timestamp later than trial end) and one whose email is still to be sent; it says 'No active plan.' (and never the trial copy) for a second team with no trial, a cancelled plan and an unpaid plan past the grace; neither text for an active trial or an active plan. Spec 23 and spec 30 pass. The dashboard strip is unchanged by design.

### D-024 · Medium · A failed Save empties the form the person just filled in
- **Status:** Verified Fixed
- **Area / page:** every form built as `<form action={...}>` around a server action: New/Edit service (`src/app/o/[org]/services/view.tsx` `submit`), Add team member sheet, Add/Edit location in Settings (found by D-020 retest; likely the same for other such forms)
- **Environment / viewport:** production Supabase + mock Stripe, local build, Chrome, 1280px
- **Steps to reproduce:**
  1. Owner opens Services > New service, types a name (and other fields).
  2. Make the request fail (go offline, or the server answers 500) and press Save.
  3. Look at the sheet.
- **Expected:** the friendly message appears and what was typed is still there, so pressing Save again works.
- **Actual:** the message appears (D-020 works) but the Name field (and the other uncontrolled fields: description, price, duration, address) is empty again; React resets a form after its action finishes, and the new error handling lets the action finish normally. Pressing Save again says 'Please fill out this field'. Team member Name and location Name are emptied the same way. Controlled choices (colour, staff, type) are kept. Before the D-020 change a request failure crashed the page, so this is new in the sense that it is now reachable; a server-returned validation error very probably empties the form the same way (same React behaviour, not checked).
- **Evidence:** `e2e/specs/30-retest-d019-d023.spec.ts` tests 'new service Save, offline / http500' and 'team Add member and location Add, request fails' (soft assertion D-024; output 'NAME after failed Save ...: ""').
- **Developer notes:** Fixed (pending retest). Shared helper submitForm() in src/components/ui/use-server-action.ts: forms use `onSubmit={submitForm(fn)}` (preventDefault, call fn with new FormData(form)) instead of `<form action={fn}>`, so React never auto-resets the form; fields stay after a failed request AND after a server validation error. Success paths unchanged (sheets close or toast; redirect()/notFound() still re-thrown by runAction). Applied to service, location, team (add + member), settings, new-session, new-booking, availability time off, customer, contact-form options. tests/run-action.test.ts; e2e/specs/31-keep-values-on-failed-save.spec.ts (request fails + validation error, service/team/location); not run by the developer.
- **Retest notes:** Verified Fixed 2026-10-19 for the forms named in the defect, plus the settings form, and for server validation errors on every converted form. Spec 31-keep-values-on-failed-save 6/6 (new service, Add team member, location editor; request lost and server validation error), spec 30 24/24, new spec 33 3/3 (success still closes and resets the sheet, a required Name still blocks with no server call, Enter submits, a double click makes exactly one service / person / location). Spec 32 (customers, time off, settings, contact options): server validation error keeps the values (customers, time off, settings) 3/3, required / Enter / double submit 3/3, settings form request-lost + retry OK. NOT fixed for customers, time off and contact options when the request itself is lost: they crash to the error screen (new defect D-025). One test fix: spec 31 expected role=alert in the new-service sheet for the server-validation case, but that sheet's error box is a plain div (see D-026), so the test now also matches the message text (a developer-guess selector).

### D-025 · Medium · A lost connection or server error on Save in Customers, Time off and Contact form options replaces the whole page and loses what was typed
- **Status:** Verified Fixed (signed-in pages); public pages see D-029
- **Area / page:** `src/app/o/[org]/customers/view.tsx:26` (customer sheet), `src/app/o/[org]/availability/view.tsx:164` (`TimeOffSheet`), `src/app/o/[org]/settings/contact-embed.tsx:21` (contact form options). They were switched to `submitForm()` (D-024) but still use plain `useTransition`, not `useSafeTransition`, so a failed request is thrown (the D-020 pattern). Other plain-`useTransition` forms were not tested: `team/view.tsx:28`, `new-session-sheet`, `booking-sheet`, `session-sheet`, `workflows/[id]/editor`, `schedule/view.tsx`, `availability/view.tsx:29`.
- **Environment / viewport:** production Supabase + mock Stripe, local build, Chrome, 1280px
- **Steps to reproduce:**
  1. Owner opens Customers > Add (or Availability > Time off > Add, or Settings > Contact form for your website) and fills in the fields.
  2. Drop the next server request (see `e2e/specs/32-d024-other-forms.spec.ts`: `page.route` aborts POSTs that carry a `next-action` header) or go offline, then press Save.
- **Expected:** a short inline message in the sheet ("Something went wrong. Please check your connection and try again.") with the typed values still there, like the new-service, team-member, location and settings forms (D-020, D-024).
- **Actual:** the whole page is replaced by "Something went wrong. We hit a problem loading this page" (Try again / Go to my dashboard). The sheet and everything typed are gone. Nothing is saved; "Try again" recovers. The same forms keep their values for a server validation message.
- **Evidence:** `e2e/specs/32-d024-other-forms.spec.ts` tests 'customers form request fails', 'time off form request fails' and 'contact form options request fails' (3 of 8 fail, 3 of 3 runs); screenshot `test-results/32-d024-other-forms-custom-*/test-failed-1.png` (git-ignored).
- **Developer notes:** Fixed (pending retest). Every plain useTransition that calls a server action now uses useSafeTransition (customers, time off + hours + delete time off, contact form options, team, calendar card, inquiries, schedule x3, workflow list + editor + test email, booking/new-booking/session sheets, push device, public cancel / cancel series / reschedule / waitlist leave / booking flow / contact form). A lost request shows the inline (or toast) message and keeps the typed values; optimistic switches (workflow on/off, schedule mode) are put back. Success paths unchanged. Not run in e2e by the developer.
- **Retest notes:** 2026-10-19. Signed-in call sites, connection lost AND HTTP 500, spec 35 (24/24 signed-in tests): customers, time off, contact form options (spec 32 8/8), inquiries (toast), workflows list (switch goes back, toast), workflow editor Save and Send test (inline / toast), team invitation revoke (toast), schedule mode switch (rolls back, inline), booking sheet Reschedule Save and Cancel booking, new booking sheet (values kept, retry closes and toasts), new session sheet, session sheet Save changes. Each: message shown, page stays, typed values kept, button enabled again, retry succeeds, no sign-in redirect. Not run in a browser: push device (no VAPID key in the harness) and calendar card Disconnect (no connected calendar), code only. PUBLIC pages: see D-029, they redirect to /login instead.

### D-026 · Low · Form errors in sheets are not announced to screen readers, and a server validation error shows raw library text
- **Status:** Verified Fixed
- **Area / page:** `src/components/ui/misc.tsx` `Notice` (a plain `div` unless `live`); about 40 call sites do not pass `live`, e.g. `src/app/o/[org]/services/view.tsx:273`, `customers/view.tsx:120`, `availability/view.tsx:199`, `settings/view.tsx:131`, `contact-embed.tsx:84`, `new-booking-sheet.tsx:301`. Raw text: `src/app/o/[org]/actions.ts:84` (`z.string().max(80)` has no message; `:112` returns `parsed.error.issues[0].message`).
- **Environment / viewport:** local build, Chrome, 1280px
- **Steps to reproduce:**
  1. Services > New service, enter a name longer than 80 characters (paste it), press Save.
- **Expected:** a plain sentence ("Keep the name under 80 characters.") in a live region (`role=alert`) so a screen reader announces it, as D-021 did for the billing messages.
- **Actual:** the red box says "Too big: expected string to have <=80 characters" (library wording) and has no role, so it is not announced. Every other form error box outside billing behaves the same (D-021 only fixed billing).
- **Evidence:** `e2e/specs/31-keep-values-on-failed-save.spec.ts` ("server validation error > new service"): `getByRole("alert")` finds nothing, the sheet screenshot shows the raw sentence.
- **Developer notes:** Fixed (pending retest). Notice red boxes are role=alert by default (live={false} opts out). New src/lib/zod-message.ts friendlyZodMessage() used by all 9 server-action parse failures: 'Name must be 80 characters or fewer.' instead of library text. tests/zod-message.test.ts.
- **Retest notes:** 2026-10-19. Verified Fixed. Over-80 name now reads 'Name must be 80 characters or fewer.' in a role=alert inside the sheet (exactly one alert in the sheet, no nested live regions on the page; Next's own route announcer is the only other alert). A failed request in the customer sheet is announced once. Split off: toasts are still not announced (D-031).

### D-027 · Low · At 200% text size the landing page header button and the headline are cut off on phones
- **Status:** Verified Fixed
- **Area / page:** `src/components/marketing/site-header.tsx` (fixed `h-14` row, `whitespace-nowrap` Get started button) and `src/components/marketing/hero.tsx` (h1 `clamp(2.25rem, 9.5vw, 4.5rem)` is rem based), also the price estimator "+" button at 320px and the footer email link
- **Environment / viewport:** local build, Chrome, 375px and 320px, root font size 200% (a phone set to the largest accessibility font, or a browser default of "very large")
- **Steps to reproduce:**
  1. Open `/` at 375px wide and set the root font size to 200% (`html{font-size:200%}`), or use a device font scale of 200%.
- **Expected:** WCAG 1.4.4 / 1.4.10: nothing is cut off; the header controls wrap or shrink and the headline breaks.
- **Actual:** the header "Get started" is clipped at the right edge ("Get star"), the headline word "effortless." is cut ("effortles"); at 320px the estimator "+" button and the footer email link also run past the edge. `overflow-x: clip` hides the overflow, so there is no scrollbar and the content is simply unreachable. At 150% text size nothing breaks; browser zoom to 200% and 400% (640px and 320px CSS width) is fine.
- **Evidence:** exploratory script (scratch folder) output `bigfont 375 200% wide: DIV.flex ... 166..459, A.inline-flex h-11 ... 236..459`; reproduce with the steps above.
- **Developer notes:** Fixed (pending retest). Header wraps (min-h-14, flex-wrap, min-h-11 buttons, no nowrap); headline clamp(1.75rem,9.5vw,4.5rem) with overflow-wrap:anywhere; estimator buttons 44px (px, not rem), card p-4, min-w-0; FAQ email link overflow-wrap:anywhere. Not measured in a browser by the developer.
- **Retest notes:** 2026-10-19. Verified Fixed for the reported items. Spec 36: at 320, 375, 390, 768, 1024, 1280 px normal text and 320/375/390 at 200%: no sideways scroll, nothing past the edge, header Get started, headline, estimator buttons and FAQ email link all inside the screen, tap targets >= 44px; only 320px/200% has a leftover (D-033 FAQ arrow) and the header height is large (D-034).

### D-028 · Low · The calendar illustration's time labels fail text contrast (3.6 to 3.75:1), so Lighthouse accessibility is 96
- **Status:** Verified Fixed
- **Area / page:** `src/components/marketing/hero.tsx` `ProductPreview` (12px semibold time labels in the column colour, `#007AFF` and `#AF52DE`, on a 12% tint of the same colour)
- **Environment / viewport:** local build, Lighthouse 13 (mobile and desktop). In dark appearance `color-contrast` fails for `#007aff` on `#192739` (3.75:1) and `#af52de` on `#2e2235` (3.64:1); in light appearance `#007AFF` on its tint is about 3.4:1 (calculated)
- **Steps to reproduce:**
  1. Run Lighthouse (accessibility) on `/`, or measure the "9:00" / "9:30" / "10:00" labels in the preview.
- **Expected:** at least 4.5:1 for 12px text.
- **Actual:** 3.6 to 3.75:1. The e2e contrast test excludes the illustration on purpose, so only Lighthouse finds it. Not a blocker: the text is sample text and the score is above the 90 target.
- **Evidence:** Lighthouse JSON (scratch folder), `color-contrast` audit, 2 items on mobile, 4 on desktop.
- **Developer notes:** Fixed (pending retest). Illustration time labels use the column colour mixed 50% toward the text colour: 5.3 to 8.7:1 in light and dark on the 12% tint (tests/contrast.test.ts). Also: the trial / no-card proof items are hidden when signed in.
- **Retest notes:** 2026-10-19. Verified Fixed. Time labels now 5.3 to 8.8:1 light and dark (computed in the browser); Lighthouse accessibility landing mobile 100 and desktop 100 (was 96). The inactive 'Week' toggle label is 4.49:1 by my 8-bit calculation but axe passes it.

### D-029 · High · A failed request on a public page sends the customer to the staff sign-in page and loses what they typed
- **Status:** Verified Fixed
- **Area / page:** `src/components/ui/use-server-action.ts` `sessionHasEnded()` used by `useSafeTransition`; public callers: `src/components/booking/booking-flow.tsx`, `src/app/booking/[token]/cancel.tsx`, `cancel-series.tsx`, `reschedule/picker.tsx`, `src/components/contact/contact-form.tsx`, `src/app/waitlist/[token]/leave.tsx` (also the /embed pages, which would navigate the customer's frame)
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. Signed OUT, open /e2e-salon, choose location, service, person, day, time, fill the details.
  2. Go offline (or make the server answer 500) and press Confirm booking. Same on /booking/<token> (Yes, cancel), /booking/<token>/reschedule (Move to), /<slug>/contact (Send message), /waitlist/<token> (Tap again to leave).
- **Expected:** the short inline message 'Something went wrong. Please check your connection and try again.', the typed values kept, the button usable, a retry works.
- **Actual:** the browser is sent to /login?error=session&next=<page> and shows the owner sign-in page saying the session ended. The customer has no account, loses everything typed and has no way to know to go back. Cause: for an anonymous visitor `supabase.auth.getUser()` returns AuthSessionMissingError without any network call, which `sessionHasEnded()` treats as 'session ended', so every failed request on a public page is a 'session end'. Before D-025 a failed request showed the error screen with Try again. Also (code): the cancel and cancel-series forms still use `<form action>`, so the typed Reason would be emptied after a failed request.
- **Evidence:** `e2e/specs/35-d025-call-sites.spec.ts` 'public pages, request fails (offline / http500)': 10 of 10 fail, all with 'navigated to http://localhost:3000/login?error=session&next=...'. Signed-in pages pass. Happy paths (specs 03, 04, 13, 17, 22) pass. Suggested fix: only treat a missing session as ended on signed-in pages (e.g. an option `useSafeTransition(onError, { checkSession: false })` for the public components).
- **Developer notes:** useSafeTransition/useServerAction take { requireSession }. Default (unset) checks the session only on /o, /onboarding, /app (isSignedInSurface in src/lib/run-action.ts); all 6 public components pass requireSession:false and never call supabase auth. Cancel and cancel-series forms now use submitForm so Reason is kept. Unit tests added (tests/run-action.test.ts).
- **Retest notes:** 2026-10-19. Verified Fixed. Spec 35 34/34 (all 10 public failure tests pass, 24 signed-in). New spec 38 (18/18), each with the connection lost AND HTTP 500: embed booking flow, embed contact form, cancel (Reason kept incl. accents and Japanese), cancel a series (Reason kept), booking with a required intake question (answer kept), group class spot reserve and waitlist join (name and notes kept), reschedule, a signed-in owner using the public booking page (also after cookies are cleared): in all, the customer stays on the page, the message is in exactly one role=alert/status region, typed values are kept, the button is enabled again, a retry succeeds and nothing goes to /login. A signed-in dashboard button with the session ended (cookies cleared) still goes to /login?error=session with the session-ended message. Test changes: spec 35 now asserts the cancel Reason is kept (was a soft annotation for the old behaviour).

### D-030 · Low · Booking pages have a large Twitter card but no share image
- **Status:** Verified Fixed
- **Area / page:** `src/lib/seo.ts` `buildBookingMetadata` (page-level openGraph/twitter replace the site-wide image)
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. curl /<slug> of any business without a logo and look at the og: and twitter: tags.
- **Expected:** og:image and twitter:image set to the default image (or twitter:card=summary).
- **Actual:** twitter:card is summary_large_image but there is no og:image or twitter:image, so a shared link has no picture.
- **Evidence:** `e2e/specs/34-seo.spec.ts` 'an active business is indexable...' fails (1 of 15); curl output.
- **Developer notes:** buildBookingMetadata sets og:image and twitter:image explicitly (absolute SITE_URL /opengraph-image.png and /twitter-image.png) when no usable logo; tests/seo.test.ts updated.
- **Retest notes:** 2026-10-19. Verified Fixed. /e2e-salon raw HTML (normal browser UA and Googlebot UA): og:image https://tempo.sulosystems.com/opengraph-image.png and twitter:image .../twitter-image.png are inside <head>; both files resolve locally to image/png 77,904 bytes. Spec 34 15/15 incl. 'an active business is indexable...'. Note: the URLs are always the production domain (SITE_URL), so on localhost they only resolve via the local path; correct for production.

### D-031 · Low · Toast messages are not announced to screen readers
- **Status:** Verified Fixed
- **Area / page:** `src/components/ui/toast.tsx` (container has no role or aria-live)
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. Make a request fail (offline) on Workflows and flip a switch.
- **Expected:** the error toast is read out (role=status / alert in a persistent live region).
- **Actual:** the toast text is in a plain div, disappears after 3.2 s and is never announced; many failed actions now report only through a toast.
- **Evidence:** `e2e/specs/36-d026-d028-landing-retest.spec.ts` 'toast messages are announced' fails.
- **Developer notes:** Toast container is now two persistent live regions: role=status (polite) for confirmations and role=alert for errors; icons aria-hidden.
- **Retest notes:** 2026-10-19. Verified Fixed. Toast container is two persistent live regions (role=status polite, role=alert assertive, aria-atomic=false). Spec 36 'toast messages are announced' passes; spec 38 counts the live regions that contain the message on every public failure: exactly one each time (no double announcement).

### D-032 · Low · Booking flow: Back from the details step forgets the chosen day
- **Status:** Verified Fixed
- **Area / page:** `src/components/booking/time-picker.tsx` (`pickedDay` starts null and ignores `selected`)
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. Choose a day well ahead and a time, press Back on the details step.
- **Expected:** the calendar shows the chosen day with the time highlighted.
- **Actual:** the calendar jumps to the first open day (today); the summary still says the chosen date. Found because spec 16 'changing the time' failed after 11:00 local time (the spec was fixed to pick the day again).
- **Evidence:** screenshot from the spec 16 failure.
- **Developer notes:** TimePicker starts on the month and day of the already chosen time.
- **Retest notes:** 2026-10-19. Verified Fixed. New spec 39: at 1280 and 375px choose a weekday 17 bookable days ahead (about 3.5 weeks, next month), time 1:00 PM, Back: the calendar shows that month and the chosen time is highlighted.

### D-033 · Low · Landing FAQ arrow cut off at 320px and 200% text
- **Status:** Verified Fixed
- **Area / page:** `src/components/marketing/faq.tsx` summary row inside an `overflow-hidden` card
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. Open / at 320px, html font-size 200%, look at the FAQ questions 'What happens to my data...' and 'Which kinds of businesses...'.
- **Expected:** the arrow fits inside the card.
- **Actual:** the arrow sits at x=307 to 308 while the card ends at 288 (clipped).
- **Evidence:** `e2e/specs/36-...` test 'D-027 landing at 320px, text size 200%' (CLIPPED #faq).
- **Developer notes:** FAQ question span is min-w-0 flex-1 with wrapping, icon flex-none, padding px-4 on phones.
- **Retest notes:** 2026-10-19. Verified Fixed. Spec 36 landing at 320, 375, 390px at 200% text and 100% at 320..1280: nothing cut off, no sideways scroll, FAQ arrows inside the card (16/16).

### D-034 · Low · Landing sticky header is 25 to 42% of the screen at 200% text on a phone
- **Status:** Verified Fixed
- **Area / page:** `src/components/marketing/site-header.tsx`
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. 375px or 320px, html font-size 200%, scroll.
- **Expected:** the header stays small or stops being sticky at large text.
- **Actual:** header height 201px at 375 and 390 (of 800/844), 297px at 320 (of 700), always on screen; nothing is cut off, but little is left to read.
- **Evidence:** measured with a script.
- **Developer notes:** Landing header is sticky only from md up (static on phones); section anchors use scroll-mt-4 below md and scroll-mt-20 from md.
- **Retest notes:** 2026-10-19. Verified Fixed. Spec 39 (measured): header position static/relative at 320, 375 and 767px (still 201px tall at 375/200% and 297px at 320/200%, but it scrolls away), sticky with top 0 at 768 and 1280px. Anchor links #features, #pricing, #faq at 375px (100% and 200% text) and 1280px land with the heading on screen (72/144 px from the top on phones, 160 px below the 57px sticky header on desktop).

### D-035 · Low · Booking page head tags are streamed into the body; Lighthouse reports no meta description
- **Status:** Verified Fixed
- **Area / page:** `src/app/[slug]/page.tsx` async `generateMetadata` with Next streaming metadata
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. curl -A 'Mozilla/5.0' and curl -A Googlebot /<slug> and compare the position of `</head>` and the title/description/canonical/robots tags; run Lighthouse on /<slug>.
- **Expected:** metadata in the head (or an owner decision that streaming is fine for Googlebot).
- **Actual:** title, description, canonical, robots and og tags are in the body for normal browsers and for Googlebot; Lighthouse SEO 91 ('Document does not have a meta description'). Next documents that Googlebot handles this; `htmlLimitedBots: /.*/` in next.config disables streaming. Needs a Search Console URL Inspection check after deploy. The landing page is unaffected (static metadata, SEO 100).
- **Evidence:** Lighthouse JSON (scratch folder), head-versus-body check.
- **Developer notes:** next.config.ts htmlLimitedBots: /.*/ (documented way to disable streaming metadata) so head tags are in <head> for all visitors. Tester: re-check head position with curl and Lighthouse SEO, and TTFB of /<slug>.
- **Retest notes:** 2026-10-19. Verified Fixed. curl /e2e-salon with a normal browser UA and with Googlebot UA: title, description, canonical, robots (index, follow), og:image and twitter:image are all before </head>. Paused business is noindex (spec 34). Unknown slug 404 has robots noindex. Lighthouse SEO booking page 91 -> 100 mobile and desktop (accessibility 95 -> 100). Cost: TTFB 287 -> 322 ms mobile run and 156 -> 248 ms desktop run (single lab runs, local; 35 to 92 ms slower, as expected since the page now waits for the data before sending the head); mobile LCP 2814 -> 2971 ms (+157 ms), performance 96 -> 95 mobile, 100 desktop unchanged. Landing page metadata and scores unchanged (95 / 100 / 100 / 100 mobile, 100 x4 desktop). The other async generateMetadata page, /<slug>/contact, has title, description and images in head (no canonical or robots tag, unchanged behaviour). Needs a Search Console URL Inspection check after deploy.

### D-036 · Low · Booking page contrast in dark appearance
- **Status:** Verified Fixed
- **Area / page:** `src/components/booking/booking-flow.tsx` (13px `text-accent` header) and the 'Powered by Tempo' footer link (`text-label-3`)
- **Environment / viewport:** local production build, production Supabase harness, mock Stripe/Resend/Twilio, Chrome, 1280px unless stated
- **Steps to reproduce:**
  1. Open /<slug> with the system in dark mode, run Lighthouse accessibility.
- **Expected:** 4.5:1.
- **Actual:** 4.23:1 (#007aff on #1c1c1e) and 3.25:1 (#5e5e62 on black); accessibility 95 mobile and desktop. Same known gap as D-019 outside billing.
- **Evidence:** Lighthouse JSON.
- **Developer notes:** Booking components use text-accent-text (blue text) and text-label-2 (small grey text) instead of text-accent / text-label-3; tests/contrast.test.ts extended. Note: text no longer follows the business's custom accent colour, only fills and icons do.
- **Retest notes:** 2026-10-19. Verified Fixed for the reported text. Computed text contrast (spec 39, canvas method) on the booking steps (location, service, times, details) and the paused page, light and dark: no text below 4.45:1 except new D-037 (selected day chip 4.02:1) and the inactive '24h' toggle at 4.49 (8-bit rounding). Lighthouse accessibility booking page 100 mobile and desktop (was 95). Custom accent (#FF9500 tried): the business colour is now used only for fills and icons (logo tile, focus ring); links, Back and small text are the fixed blue and buttons stay the Tempo blue; it looks consistent and not broken (readable in light and dark), but the brand colour has less presence than before on the steps after choosing a service. The logo initial is white on the business colour (white on #FF9500 is about 2.2:1; 24px bold, below even the 3:1 large-text bar for light colours; a business's own choice, mentioned in D-037).

### D-037 · Low · Selected day and time chips on the booking page are white on blue at 4.02:1
- **Status:** Verified Fixed
- **Area / page:** `src/components/booking/time-picker.tsx` (selected day `bg-accent text-white`, selected time `bg-accent text-white`), also the logo tile initial (white on the business colour)
- **Environment / viewport:** local production build, Chrome, 375 and 1280px, light and dark
- **Steps to reproduce:**
  1. Open /<slug>, choose location, service and person, then a day: the chosen day number is white on #007AFF.
- **Expected:** 4.5:1 for 15px text (the same bar D-036 applied to the other booking text).
- **Actual:** 4.02:1 (computed, both themes); the selected time chip uses the same classes. White on a business's bright accent colour is lower still (white on #FF9500 about 2.2:1 for the logo initial). Lighthouse does not see it (it runs before anything is selected).
- **Evidence:** `e2e/specs/39-d032-d034-d036-retest.spec.ts` 'booking page steps in light / dark' (2 fail: '19' 4.02 size 15).
- **Developer notes:** Selected day, time chip and selected intake option now use bg-accent-fill with white text; logo tile initials pick white or black per business colour via src/lib/color.ts readableOn (always >= 4.58:1).
- **Retest notes:** 2026-10-19, production harness, mock services only. Spec 39 16/16 (was 14/16). New spec `e2e/specs/40-d037-accent-contrast.spec.ts` (30 tests; accents #007AFF, #FF9500, #34C759, #FFF176, #1C1C1E x light/dark x 375/1280, plus the contact form). Selected time chip, hovered time chip and selected yes/no option (white on bg-accent-fill) 5.61:1 in every combination; selected day >= 12 measured (same classes; sampled value likely mid-transition, visually white on blue); keyboard focus ring on chips visible (3px outline + 4px halo, light and dark); selected state clearly visible in screenshots. Logo initial / any-person icon, worst point of the gradient: FF9500 5.31/5.84, 34C759 5.27/5.79, FFF176 9.52/10.34, 1C1C1E 7.34/7.04, #007AFF light >= 5.48 but dark 3.16/3.51 (see D-039). Full booking completed (blue desktop light; pale yellow mobile dark); reschedule picker passes in spec 04 (6/6). Customer-facing booking spec 03 7/7, 14 12/12, 15 9/9, 13 30/31 first run (1 flaky, passes alone twice).

### D-038 · Low · Dashboard text fails contrast outside the billing page (sidebar, small grey text, white on blue buttons)
- **Status:** Open
- **Area / page:** dashboard shell and pages, e.g. sidebar section titles, the role and email under the person's name (`text-label-3`, 2.42:1), active nav item and `bg-accent text-white` buttons (4.01:1), small `text-label-2` text on tinted cards (4.26 to 4.47:1)
- **Environment / viewport:** local production build, Chrome, 1280px, light, owner on /o/<slug>/settings/billing (axe-core 4 WCAG 2 A/AA)
- **Steps to reproduce:**
  1. Run the optional axe scan in `e2e/specs/29-billing-a11y.spec.ts` (E2E_AXE_DIR set), or axe on any dashboard page.
- **Expected:** 4.5:1 for small text (D-019 did this for the billing items only).
- **Actual:** about 10 color-contrast violations (serious) per dashboard page: #a4a4a7 on #fcfcfd (2.42:1), white on #007aff (4.01:1), #696c76 on #dde9f8 (4.26:1). The same colours were fixed on the public booking page in D-036. Not caused by this release (same shell as before); the axe scan is skipped by default so earlier runs did not show it.
- **Evidence:** `e2e/specs/29-billing-a11y.spec.ts` 'axe-core scan' (fails 3 of 3 pages when run with E2E_AXE_DIR); node list in the run output.
- **Developer notes:**
- **Retest notes:**


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

### D-039 · Low · Dark theme, default blue colour: logo initial and 'any person' icon below 4.5:1
- **Status:** Open
- **Area / page:** `src/components/booking/booking-flow.tsx` (logo tile, StaffCard any icon), `src/components/contact/contact-form.tsx` (logo tile); `readableOn()` in `src/lib/color.ts`
- **Environment / viewport:** local production build, Chrome, 375 and 1280px, dark theme, business colour #007AFF (the default)
- **Steps to reproduce:**
  1. Dark theme, open /<slug> (or /<slug>/contact) for a business with the default blue.
  2. The tile gradient is accent at 73% over the dark page at the top, so the top is darker than #007AFF; `readableOn` chose black from the flat colour.
- **Expected:** 4.5:1 (the target the developer notes state).
- **Actual:** black initial on the lightest-to-darkest gradient: 3.16:1 (booking logo), 3.51:1 (any-person icon, contact logo). Meets WCAG 3:1 for large (24px bold) text and graphics; fails 4.5:1. Light theme and the other four accents pass (>= 5.27). Black on iOS blue also looks unusual next to the old white.
- **Evidence:** `e2e/specs/40-d037-accent-contrast.spec.ts` (3 of 30 fail: 007AFF dark 375, dark 1280, contact dark); screenshot of the dark booking page shows the black E on blue.
- **Developer notes:**
- **Retest notes:**
