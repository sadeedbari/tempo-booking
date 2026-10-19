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

## Billing UI (browser) – Playwright specs 23-29 (2026-10-18)

Run against the PRODUCTION Supabase project (user-authorised 2026-10-18, harness data only, real data untouched) with the stand-in Stripe, email and SMS (`e2e/mock-services.mjs`; no live key used). Start with `bash e2e/dev-server.sh`, then `E2E_ALLOW_LIVE=1 bash e2e/run-all.sh results.txt` (re-seeds before each file) or one file: `E2E_ALLOW_LIVE=1 node e2e/seed.mjs && E2E_ALLOW_LIVE=1 npx playwright test e2e/specs/23-billing-page-owner.spec.ts`. Optional axe scan: set `E2E_AXE_DIR` to a folder (outside the repo) that has `@axe-core/playwright` installed. Plan states are set per test with `setPlan()` (`e2e/specs/billing-helpers.ts`, `setPlanState()` in `e2e/lib.mjs`).

### Results (full run 2026-10-18; every new spec was also run on its own while it was written)
| Spec | Covers | Tests | Pass | Fail | Notes |
|---|---|---|---|---|---|
| 23-billing-page-owner | a. trial page at 375/768/1280, live price ($15/$30/$20/$35/$55/$515), input clean-up, URL prefill, Checkout success/cancelled/processing/another team's session/no-trial notice, double-click, tampered quantities (21 crafted bodies, Subscribe and Update plan), active page, plan up (prorated, charged now) and down (credited, blocked above usage, crafted request refused), locations in use, cancel guard (single click, fast double click, disarm after 6 s, confirm) and resume, Manage billing and return, expired/cancelled pages | 32 | 32 | 0 | |
| 24-billing-roles-banner | b, c. plan strip for 10 states x owner/admin/staff x 3 widths, no overlap at 375, contrast, billing page for admin/staff in 5 states (no dates, prices, buttons), Settings link, billing server actions refused for admin, staff and another team's owner | 18 | 17 | 1 | the failure is D-019 (strip contrast) |
| 25-billing-limits | d. 6th person (trial link, owner one-click add-on, admin "ask the owner", invitation), crafted add-on request, invitations hold seats (meter, chooser), 2nd location (trial link, owner add-on, admin), hidden locations, no plan | 15 | 15 | 0 | |
| 26-billing-paused | e. paused booking page / embed / contact form / embed contact in 4 states x 3 widths, grace and cancelling plans not paused, phone/website (javascript: link not rendered), DB refuses booking, customer cancel and reschedule, read-only dashboard (owner and admin wording), reads and exports work, resubscribe through Checkout restores everything | 14 | 14 | 0 | |
| 27-billing-onboarding | f. first team trial, second/third team no trial ("Choose a plan", paused page), cap page at 3 widths, team menu without "New team", stale form at the cap, DB cap | 9 | 9 | 0 | |
| 28-billing-errors | g. Checkout / Portal / plan change / declined card / cancel / resume / add-on failures (friendly text, no raw Stripe text), unpaid subscription -> Open Manage billing, healthy subscription we missed, no portal configuration and billing not set up (second server on 3001/3002), lost connection, HTTP 500, ended session, missing subscription row | 14 | 11 | 3 | the 3 failures are D-020 |
| 29-billing-a11y | h. headings, names, live price, keyboard-only flows, focus visible, 375/768 layout in 7 states, paused page landmarks and contrast, upgrade prompt by keyboard, axe-core | 18 | 14 | 4 | failures: D-019 (page contrast, axe color-contrast), D-021, D-022 |
| **New total** | | **120** | **112** | **8** | all 8 are logged defects (D-019 x3, D-020 x3, D-021, D-022); 0 harness failures left |

Full-suite totals (one run, 22:49): API (node --test, 6 groups): 131 pass, 0 fail. Playwright 01-29: 361 tests, 350 pass, 11 fail: the 8 new-spec defect failures above, plus 3 that did not repeat (all pass when re-run alone, 3 of 3 times each): 10-monkey "adminA > settings" and "staffA1 > dashboard" (the computer went to sleep during that file: timeout of 4.8 h and `ERR_NETWORK_IO_SUSPENDED`, environment) and 16-recurring "adding a repeating booking books each date" (flaky, passed 3/3 alone).

### Billing UI coverage: every control on each billing screen
| Screen / control | State(s) | Spec |
|---|---|---|
| Billing > Extra locations / Staff packs boxes (typing, clean-up, prefill from `?locations=&packs=`, keyboard) | trial, active, expired | 23, 29 |
| Billing > "Subscribe for $X/month" enabled, press, double-click, error, keyboard Enter | trial, expired | 23, 26, 28, 29 |
| ... disabled: plan too small for current usage | expired with 7 people; expired with 2 locations | 23, 26 |
| ... disabled: billing not set up on the server | trial (second server) | 28 |
| Billing > "Update plan" enabled (up/down), disabled (unchanged, does not fit, billing not set up), failure, declined card, keyboard Space | active | 23, 24, 28, 29 |
| Billing > "Manage billing" (press and return, failure, no portal configuration, disabled when billing not set up, absent on trial, keyboard) | active, cancelled with customer, trial | 23, 28, 29 |
| Billing > "Open Manage billing" (appears after an unpaid-subscription refusal; press) | expired with unpaid Stripe subscription | 28 |
| Billing > "Cancel at period end" / "Tap again to confirm" (single, double, disarm, confirm, failure, disabled when not set up, keyboard) | active | 23, 28, 29 |
| Billing > "Keep my subscription" (press, failure, keyboard) | cancelled at period end | 23, 28, 29 |
| Billing > success / processing / cancelled / no-trial notices | after Checkout, junk session ids, second team | 23, 27 |
| Billing > usage meters (locations, team members, invitations waiting) | trial, active, with invitations | 23, 25, 29 |
| Billing page for admin/staff (notice only, no controls) | trial, past due, cancelling, healthy, ended | 24 |
| Plan strip > "Open billing" link (owner), no link (admin/staff), keyboard | trial 10/3/1 days, ended, past due, grace over, cancelling, cancelled, healthy | 24, 29 |
| Settings > "Open billing" card (owner), absent for admin/staff | trial | 24 |
| Upgrade prompt > "Add and continue (+$5/month)" / "(+$15/month)" (press, failure, keyboard) | active at the limit | 25, 28, 29 |
| Upgrade prompt > "Choose a plan" link (press, keyboard) | trial at the limit | 25, 29 |
| Upgrade prompt text only (no button/link) | admin, no plan | 25, 26 |
| Team "Add team member" sheet (Escape, submit, invite switch) and Locations "Add" sheet | limits | 25, 29 |
| Paused page (booking, embed, contact, embed contact): website link (href, rel, javascript: not rendered; not clicked: external) | trial ended, no plan, cancelled, grace over | 26, 29 |
| Customer "Cancel booking" / "Reschedule" on a paused team | trial ended | 26 |
| Onboarding "Create team", cap page "Back to my dashboard", team menu "New team" and team links | first, second, third team | 27 |
| Dashboard writes while read-only: New service Save, Settings Save changes, Add team member | trial ended (owner, admin) | 26 |

### Not covered
Stripe Checkout/Portal pages themselves (real Stripe test mode), real card payments and 3-D Secure, tax; dark mode contrast; screen-reader (NVDA/VoiceOver) behaviour (only roles, names and live regions checked); the "Tap again" guard on real touch devices; Safari/Firefox; concurrency of two owners' tabs changing the plan at once; "Keep my subscription" disabled when billing is not set up; creating a team when `TRIAL_CLAIM_SECRET` is missing (skipped by instruction); the website link on the paused page was not clicked; emails other than "plan was updated" (covered by API specs).

### Retest of D-019..D-023 (2026-10-19) - `e2e/specs/30-retest-d019-d023.spec.ts`
| Defect / area | Check | Result |
|---|---|---|
| D-019 | Contrast (computed styles) of plan strip, billing hints/badges/notice, filled buttons, in light AND dark (emulated) | pass, all >= 4.5 |
| D-020 | Subscribe and New service Save: offline, HTTP 500 (inline role=alert message, page usable, button re-enabled, retry works); ended session on Subscribe, Save, Manage billing goes to /login?error=session with message | pass |
| D-021 | Failure message in role=alert, strip / banners role=status | pass |
| D-022 | Dialog name, named switches, focus in, Tab/Shift+Tab trap (40 presses), Escape and X return focus to opener, autofocus typing | pass |
| D-023 | Ended trial (unswept, swept, email pending) says "Your trial has ended."; no-trial second team, cancelled, unpaid say "No active plan."; active shows neither | pass |
| D-024 (new) | A failed Save keeps what was typed (new service, team member, location) | pass after the fix (2026-10-19, see below) |
| Visuals | Screenshots of billing, dashboard, services, team, settings, New service sheet at 375/768/1280 (+ dark) in `test-results/retest-shots` (git-ignored); no sideways scroll, sheet inside the screen | pass |
Harness changes: spec 29 expected "No active plan." for an ended trial (stale after D-023) now "Your trial has ended."; spec 16 team test used `futureDay(40)` which collides with a series booked by an earlier test depending on today's date, now `futureDay(100)`.
Still not covered: real screen readers; other pages' remaining plain `useTransition` call sites (customers, availability, workflows, booking sheets) under failed requests.

## Retest of D-024 and the landing page refresh (2026-10-19)

Environment: production Supabase project with the harness (tagged rows only), mock Stripe/Resend/Twilio, local `npm run build` + `next start`. Real data counts were identical before and after (see project/status.md).

### D-024: a failed Save keeps what was typed
| Spec | Case | Result |
|---|---|---|
| `31-keep-values-on-failed-save` | new service, Add team member, location editor: request lost, and server validation error; values kept, Save enabled again | 6/6 pass (the service/server-error case needed a test fix, see D-026) |
| `30-retest-d019-d023` | includes retry then success after a failed Save | 24/24 pass |
| `33-d024-no-regression` (new) | success closes and resets the sheet; required Name blocks with no request; Enter submits; double click makes one service / person / location | 3/3 pass |
| `32-d024-other-forms` (new) | customers, time off, settings, contact options: server error keeps values, required field blocks, Enter submits, double submit = one row, retry succeeds | 5/8 pass; request-lost on customers, time off, contact options fail = D-025 (open) |
Regression run of every spec that opens a sheet or form (02, 05-22, 23-29, 10-monkey): all pass. Spec 19 (spots can't go below who is booked) and spec 23 (fast double-click on cancel) each failed once while other browser scripts ran at the same time, then passed 3 of 3 alone: flaky under load. Spec 28 and 29 failed in one run only because the local server process died (connection refused from then on); they pass 14/14 and 17 pass + 1 skipped (axe) on a fresh server. Cause of the server exit not found (no error in its log); not reproduced in two later full runs.

### Landing page (`/`): acceptance criteria section 6
| Criterion | How checked | Result |
|---|---|---|
| Features and copy match code | every feature line read against src (calendar slot click, ics/cancel route, embed floating button, inquiries Create booking, calendar-card Google/Outlook, copy previous period, session-sheet attendance, manifest, theme system) | no feature found that the app lacks |
| Prices match billing.ts; $15/$30/$35/$55 | `e2e/specs/31-landing-page` + 10 more combinations by hand (e.g. 4 loc/3 packs $75, 7/10 $155, 21/40 $515) | pass |
| CTA text, trial line near CTA and in pricing | spec 31 | pass |
| Signed-in header: Open Tempo, Go to your calendar, no sign-up buttons or trial line | spec 31 (harness login) + screenshots 320/375/768/1280, light and dark | pass (the proof strip still says "14-day free trial" when signed in: cosmetic, not logged) |
| No horizontal scroll, nothing wider than screen | 320, 360, 375, 390, 414, 768, 1024, 1280, 1440, light and dark | pass |
| Tap targets >= 44px, text >= 16px | all links, buttons, summaries, switch at every width above | pass (illustration excluded for text) |
| Header at 320px | spec 31 and screenshot | pass |
| Anchor links below the sticky header | 320, 375, 768, 1280 | pass |
| Tab order, focus visible, skip link, FAQ keyboard, estimator keyboard and live region | spec 31 + tab walk at 375 and 1280 | pass |
| Contrast light and dark | spec 31 (text) + Lighthouse | pass for text; D-028 (illustration, Low) |
| Reduced motion | emulated: animation and chevron transition about 0 | pass |
| Print | emulated print media, 9 A4 pages, readable | pass |
| Slow network: first render and layout shift | throttled (400 ms, 400 kbit/s, CPU x4): FCP 1.7 to 2.0 s, CLS 0.0004 | pass |
| 200% text | root font 200% | D-027 (Low); browser zoom 200% and 400% pass |
| Metadata, JSON-LD, sitemap, robots, links | spec 31; curl 200s for /, /signup, /login, /privacy, /terms, 404 for unknown | pass |
| Lighthouse (local build, scratch install): mobile | performance 95, accessibility 96, best practices 100, SEO 100 (LCP 2.8 s, CLS 0, TBT 60 ms) | meets >= 90 |
| Lighthouse: desktop | performance 100, accessibility 96, best practices 100, SEO 100 | meets >= 90 |
Notes: the page is rendered per request (it checks sign-in), so it is served `no-store` (no back/forward cache); fine for correctness. Screenshots: `project/marketing/landing-screenshots/` (375 and 1280, light and dark, signed out; signed in 375 and 1280 light) and every width in `test-results/landing/` (git-ignored).
Harness changes: `e2e/specs/31-keep-values-on-failed-save.spec.ts` (server-error alert locator also matches the message text); new `e2e/specs/32-d024-other-forms.spec.ts` and `e2e/specs/33-d024-no-regression.spec.ts`.
Still not covered: a real screen reader, real devices (Safari/iOS, Android), Firefox/WebKit, the other plain-`useTransition` forms under a failed request (team page, new session sheet, booking sheet, session sheet, workflow editor, schedule, availability hours), lighthouse against production.

### Retest 2026-10-19 (D-025..D-028, SEO-001..013)
| Spec / check | Covers | Result |
|---|---|---|
| `35-d025-call-sites` (new) | failed request (offline and HTTP 500) on: inquiries, workflow switch and editor (Save, test email), team revoke, schedule switch, booking sheet (Reschedule, Cancel), new booking sheet, new session sheet, session sheet, customers; and on the PUBLIC booking flow, cancel, reschedule, contact form, waitlist leave | signed-in 24/24 pass; public 10/10 fail = D-029 (sent to /login) |
| `36-d026-d028-landing-retest` (new) | role=alert and friendly text for an over-80 name, toasts live region, landing at 320-1280 px and 200% text (overflow, clipping, 44px), illustration contrast, signed-in/out proof strip | 13/16 pass; fails: D-031 toast, D-033 FAQ arrow at 320/200% |
| `37-landing-screenshots` (new) | refreshes project/marketing/landing-screenshots (not an assertion test) | 8/8 |
| `34-seo` (fixed: canonical without trailing slash, absent-tag helper) | robots, sitemap, llms.txt, noindex auth pages, landing metadata and images, JSON-LD, booking page index policy, paused, embed, unknown slug | 14/15; fails: D-030 |
| Manual: Google-style robots matcher, curl of /, /login, /privacy, 404, booking page, image dimensions, Lighthouse (landing and booking page, mobile and desktop) | see status.md | done |
Spec edits (old behaviour encoded): 31-landing-page (canonical/og:url without slash; /login and /signup no longer in sitemap), 34-seo (same, plus a helper that hung on absent tags), 16-recurring (after Back the calendar shows the first open day: the spec picks the day again, it failed after 11:00 local time).
Not covered: push device and calendar Disconnect under failure (no VAPID key / connected calendar in the harness), a business with no services in a browser, real screen readers and devices.

### Final retest 2026-10-19 (D-029..D-036)
| Spec | Covers | Result |
| --- | --- | --- |
| `35-d025-call-sites` | failed request (offline and HTTP 500) on public pages (booking flow, cancel with Reason kept, reschedule, contact, waitlist leave) and 24 signed-in call sites | 34/34 |
| `38-d029-public-failures` (new) | D-029 end to end, offline and HTTP 500: embed booking and embed contact, cancel (Reason kept), cancel a series, booking with a required intake question, group-class reserve and waitlist join, reschedule; message in exactly one live region; signed-in owner on a public page (also with cookies cleared); dashboard button with ended session goes to /login?error=session | 18/18 |
| `34-seo` | robots, sitemap, metadata, og/twitter image (D-030) | 15/15 |
| `36-d026-d028-landing-retest` | toasts announced (D-031), landing 320-1280 and 200% text (D-033), illustration contrast | 16/16 |
| `39-d032-d034-d036-retest` (new) | Back keeps day and time (D-032), header sticky only from 768px and anchors land (D-034), computed text contrast of the booking steps and the paused page in light and dark, custom accent colour | 14 pass, 2 fail = D-037 (selected day chip 4.02:1) |
Manual (script, not in the suite): `/<slug>` raw HTML head check for browser and Googlebot UAs, TTFB, Lighthouse mobile and desktop (landing and booking page).
Spec edits (old behaviour or guessed selector): 35 (cancel Reason now a hard assertion), 31-landing-page (header sticky only from tablet width), 29-billing-a11y (`getByRole("status")` matched the new toast live region too; now filtered by text), 37 (adds booking-page screenshots). Optional axe scan (29, E2E_AXE_DIR) fails on dashboard contrast: D-038.

### D-037 focused retest 2026-10-19 (scope reduced by the owner; broad suite intentionally not re-run)
| Spec | Covers | Result |
| --- | --- | --- |
| `39-d032-d034-d036-retest` | booking contrast, Back keeps day (selector updated to bg-accent-fill) | 16/16 |
| `40-d037-accent-contrast` (new) | selected day/time chip, hovered chip, chip focus ring, selected yes/no option, logo initial and any-person icon, contact logo; 5 accents x light/dark x 375/1280; two full bookings | 27/30 (3 = D-039, dark default blue tile 3.16/3.51) |
| `03`, `04` (reschedule), `13` (contact form), `14`, `15` (intake), `12` | public flows using the changed components | 7/7, 6/6, 30/31 (1 flaky, passes alone x2), 12/12, 9/9, 24/24 |
| `38`, `35`, `34`, `36`, `37`, `31-landing`, `30` | earlier in the same session, before the scope cut | 18, 34, 15, 16, 12, 30, 24 all pass |
Not re-run (intentionally): 01, 02, 05-11, 16-29, 32, 33, 10-monkey, API tests.

