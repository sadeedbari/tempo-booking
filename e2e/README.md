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
