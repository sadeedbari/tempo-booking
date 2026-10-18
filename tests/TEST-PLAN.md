# Test plan: subscription billing

Source: `project/requirements.md` section 5. Run commands are at the bottom. Nothing here touches the remote Supabase project or Stripe.

| Acceptance criterion | Tests | Where | Result (2026-10-17) |
|---|---|---|---|
| F1 new org has 14-day trial, no Stripe customer | new org trial row | `tests/sql/billing-migration.test.mjs` | pass |
| F1 existing org gets 14 days from release | backfill | sql test | pass |
| F2 1 location / 0 packs = $15 | price | `tests/billing-edge.test.ts` | pass |
| F2 3 locations + 2 packs = $55, 3 loc / 25 staff | price and limits | edge test, sql test | pass |
| F2 Checkout to active | webhook applies subscription | `tests/webhook/billing-webhook.test.ts` | pass (real Checkout not run) |
| F4 refuse removing a pack with 6 staff | planFits | edge test | pass (server action not run) |
| F5 location limit enforced for any client | 2nd location, reactivation, multi-row, CTE | sql test | pass |
| F5 staff limit (5th/6th, 25th/26th, every membership) | add_team_member, bulk insert | sql test | pass |
| F5 owners only | subscription row read/write, billing_status, grants | sql test | pass; server-action gate by static review only |
| F6 expired: no booking via page/API/embed, dashboard read-only | public RPC, dashboard insert, RLS update/delete, org settings, waitlist, class sessions | sql test | pass, with defects D-001, D-002, D-003, D-009 |
| F6 export still works | read of bookings/customers when expired | sql test (data); export route by static review | pass |
| F7 forged/replayed/out-of-order webhook | signature, replay, order, retry, unknown org, hijack attempt | webhook test | pass |
| F8 failed payment, 7-day grace | grace boundaries in SQL, TS and sweep; email by static review | sql, edge, webhook tests | pass (email not run) |
| F10 cancel at period end | flag, +2 days slack, sweep | sql, webhook tests | pass |
| Stripe Connect deposit flow unchanged | static diff review (webhook/route.ts untouched, proxy matcher only adds billing path) | manual | no change found |

Not automated (manual or not run): Stripe Checkout/Portal against Stripe test mode, browser UI (keyboard, focus, 375/768/1280 layouts, contrast of the orange banner), multi-tab double-submit, existing `e2e/*` suite (targets the live project), concurrent-insert race on the limit triggers.

## Run
```
npm run typecheck && npm run lint && npm test && npm run build
# SQL (needs a scratch folder with: npm i @electric-sql/pglite)
PGLITE_DIR=<folder> node tests/sql/billing-migration.test.mjs
# Webhook route + hourly sweep
npx tsx --conditions react-server --test tests/webhook/billing-webhook.test.ts
```
The SQL test prints 3 expected failures until D-001 and D-009 are fixed.

## Round 2 (retest after developer fixes, 2026-10-18)
Added `tests/sql/billing-retest.test.mjs` (93 checks) and `tests/webhook/billing-retest.test.ts` (8 checks). Run both with the commands above, plus:
```
PGLITE_DIR=<folder> node tests/sql/billing-retest.test.mjs
npx tsx --conditions react-server --test tests/webhook/billing-retest.test.ts
```
The "3 expected failures" note above is obsolete: `billing-migration.test.mjs` now passes 96/96.

| Area | Cases | Result |
|---|---|---|
| D-001 definer RPCs | move_class_booking / move_class_session refused when expired (owner and plain member, clear message, hint billing), work on a plan (booking and whole session move), function bodies diffed against the original migration (only the added check differs) | pass |
| D-002 read-only tables | service_staff, member_locations, workflow_services, workflow_steps, calendar_connections, memberships (insert/update/delete) refused when expired and allowed on a plan; a member can still leave; owner can still delete the team; generic audit lists the only uncovered write policies (organizations delete, profiles update, push_subscriptions: all intended) | pass |
| D-004 double subscription | webhook cancels the duplicate, takes over a dead one, ignores an ended one (existing); Checkout refuses when Stripe already has a live (or unpaid/paused) subscription and syncs our row; idempotent Checkout and customer creation; expires_at inside Stripe's 30 min to 24 h window; prices only from our price ids | pass |
| D-012 emails / races | one failed-payment email for three retries, another for a new problem; duplicate event id sends one email; webhook plus Checkout-return race sends one "started" | pass |
| Trial farming (S-001, D-013) | delete and recreate, case, +tag, two +tags, padded spaces, gmail dots/googlemail, non-gmail dots (distinct), degenerate address, no email, unverified (then verified earns the trial), failed create does not burn the claim, 4th team refused, cap leaves invitations to other teams working, no-trial team can subscribe and then behaves normally, trial_claims/organizations/memberships not writable by users, backfill from legacy teams (merged keys, null email, admin-only) and service-role insert claims nothing | pass |
| Regression | recurring series, class waitlist (join and auto-promote) on a plan and refused when expired, customer can still cancel a series; Connect webhook and stripe.ts have no diff | pass |
| Not run | browser UI (D-005, D-008, D-014 only reviewed in code), real Stripe, true concurrency (PGlite is one connection), `e2e/*` (live project), onboarding page/action only reviewed in code | - |
