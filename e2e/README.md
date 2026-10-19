# End-to-end tests

These tests drive a real, local copy of Tempo in Chrome and check it against the same Supabase project as `.env.local`.
They create **clearly tagged test data** (teams whose link starts with `e2e`, people at `@tempo-e2e.test`) and delete
it again. They never send a real email or text and never talk to Stripe: a local stand-in
(`mock-services.mjs`) records what would have been sent so tests can look at it.

## Safety rules

- Everything refuses to run unless `E2E_ALLOW_LIVE=1` is set. That is deliberate: `.env.local` points at the live
  database and holds live keys.
- `dev-server.sh` starts Tempo with the Resend, Twilio and Stripe settings **replaced** by the stand-in, and with
  `TEMPO_E2E=1`. In that mode the hourly job only touches teams whose link starts with `e2e`.
- `cleanup.mjs` removes only teams starting with `e2e` (or created by a test person) and people whose email ends in
  `@tempo-e2e.test`. It never touches anything else.

## Running

```bash
bash e2e/dev-server.sh                      # terminal 1: stand-in services + local Tempo (builds first)
E2E_ALLOW_LIVE=1 node e2e/seed.mjs          # create the test world (two teams, six people, services, locations)
E2E_ALLOW_LIVE=1 node --test e2e/api/*.test.mjs        # database and background-job checks (fast)
E2E_ALLOW_LIVE=1 npx playwright test e2e/specs/03-public-booking.spec.ts   # one browser spec
E2E_ALLOW_LIVE=1 bash e2e/run-all.sh results.txt       # everything, re-seeding before each file
E2E_ALLOW_LIVE=1 node e2e/cleanup.mjs       # remove all test data when finished
```

Each spec assumes a freshly seeded world, so re-run `seed.mjs` between runs of the same file.

## What is covered

| Area | Where |
| --- | --- |
| Public booking rules, races, validation, tokens, anonymous access | `api/booking.test.mjs` |
| Permissions: other teams, staff, admins, owners, people without a login, invitations | `api/permissions.test.mjs` |
| Hourly job, reminders, texts and consent, custom workflows, housekeeping, Stripe webhook | `api/system.test.mjs` |
| Shifts, locations, copy/fill tools | `api/schedule.test.mjs` |
| Sign in, 404s, redirects, other teams | `specs/01` |
| Creating a team | `specs/02` |
| The booking page end to end | `specs/03` |
| The customer's booking page: cancel, reschedule, calendar file | `specs/04` |
| Calendar bookings, requests, status changes | `specs/05` |
| Services, settings, locations, payments button | `specs/06` |
| Team, hours, time off, schedule, exports | `specs/07` |
| Workflows editor and activity | `specs/08` |
| Customers, Home, Excel exports | `specs/09` |
| Click-everything "monkey" pass for every role | `specs/10` |
| Invitations, forgot/reset password, sign-up errors | `specs/11` |
| Phone-sized layout checks | `specs/12` |

## Billing screens (specs 23-29)

| Area | Where |
| --- | --- |
| Billing page as owner: trial, plan chooser and live price, Checkout (stand-in) success / cancelled / processing, active plan, plan change up and down, cancel and resume, Manage billing, tampered quantities | `specs/23` |
| Plan strip for every state and role, the billing page for admin and staff, billing actions refused for non-owners, strip contrast | `specs/24` |
| Plan limits and the upgrade prompt: 6th person, 2nd location, invitations holding seats, hidden locations | `specs/25` |
| No active plan: paused booking page / embed / contact form, existing customer bookings, read-only dashboard, exports, subscribing again | `specs/26` |
| First team trial, second and third team without one, the 3-team cap | `specs/27` |
| Error paths: Stripe failing, unpaid subscription, billing not set up (a second server on ports 3001/3002), lost connection, expired session | `specs/28` |
| Accessibility: headings, labels, keyboard only, focus, contrast, 375px, optional axe-core scan | `specs/29` |

Billing specs put a team into a plan state with `setPlan()` (`specs/billing-helpers.ts`, backed by `setPlanState()` in `lib.mjs`) and
use the stand-in Stripe:

- `GET /pay/<session>` is a stand-in Checkout page (links "Pay" and "Cancel" that go to the success / cancel URL of the real session).
- `GET /portal/<customer>?return=...` is a stand-in Customer Portal with a link back.
- `POST /__mode {"checkout":"fail"}` (also `portal`, and `subupdate` = `fail` or `card`) makes Stripe fail with raw text that must never reach a browser.
- `POST /__subscription {..., "replace": true}` puts one subscription on a customer (what `setPlan` uses).
- Idempotency keys are honoured like Stripe's, and recorded in `GET /__sent` (`idem`).

`node e2e/counts.mjs` prints row counts (read-only) to prove a run left real data alone. For the optional axe scan install
`@axe-core/playwright` OUTSIDE the repo and run with `E2E_AXE_DIR=<that folder>`. Spec 28 starts a second copy of the built app
(ports 3001 and 3002) with billing settings removed; it needs `npm run build` to have run (dev-server.sh does that).

## Failed requests, SEO and landing retests (specs 30-39)

| Area | Where |
| --- | --- |
| Failed requests (connection lost / HTTP 500) on signed-in screens and on public pages and embeds (never a redirect to /login for a customer) | `specs/35`, `specs/38` |
| Keep typed values after a failed Save | `specs/31-keep-values`, `32`, `33` |
| robots, sitemap, metadata, share images, booking page indexing | `specs/34` |
| Landing page layout, large text, header, toast announcements, FAQ | `specs/31-landing-page`, `36`, `39` |
| Back keeps the chosen day, booking page contrast, custom accent colour | `specs/39` |
| Screenshots for `project/marketing/landing-screenshots/` (landing and booking page) | `specs/37` |

The built app has been seen to exit silently under a long run; restart it (a small loop that runs `next start` again is enough).

