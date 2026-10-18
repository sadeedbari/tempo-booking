# Security & Compliance Report

> Maintained by the `security` agent. Last review: 2026-10-18, round 4 (focused re-check of the billing follow-ups: S-018, S-019, D-018 sticky expiry, migration 20261102; code review plus PGlite and webhook suites; no remote project, no live Stripe).

## Release gate
**Security release gate: MET.** No Critical and no High finding is open, and no Medium. Open: 1 Low (S-011 privacy policy, needs legal review), 3 Info (S-017 live key in local env, S-019 reopened: docs not changed, S-020 race-loser residual and stale docs). S-012..S-016 and S-018 are Closed. Remaining conditions are human tasks listed under "Not verified". This is a technical gate only, not legal certification.

## Scan results
| Tool | Date | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| npm audit (whole repo; raw: project/security-scans/npm-audit-billing-2026-10-17.json, not re-run) | 2026-10-17 | 0 | 5 | 2 | 0 |
| Manual review round 1 (S-001..S-011) | 2026-10-17 | 0 | 0 | 5 | 6 |
| Re-verification round 2: S-001..S-010 all Closed; new S-012..S-017 | 2026-10-18 | 0 | 0 | 1 | 5 (+1 Info) |
| Executed: PGlite migration suite tests/sql/billing-migration.test.mjs | 2026-10-18 | | | | 96 passed, 0 failed |
| Executed: webhook suite tests/webhook/billing-webhook.test.ts | 2026-10-18 | | | | 26 passed, 0 failed |
| Executed: billing unit tests (tests/billing*.test.ts) | 2026-10-18 | | | | 20 passed, 0 failed |
| Executed: adversarial PGlite probes (scratchpad, not committed) | 2026-10-18 | | | | see findings S-001, S-002, S-009, S-012, S-013 |
| Round 3 re-verification: S-012..S-016 Closed; new S-018, S-019 | 2026-10-18 | 0 | 0 | 0 | 1 (+1 Info) |
| Executed: PGlite migration suite tests/sql/billing-migration.test.mjs (re-run) | 2026-10-18 | | | | 125 passed, 0 failed |
| Executed: PGlite tests/sql/billing-retest.test.mjs (re-run) | 2026-10-18 | | | | 106 passed, 0 failed |
| Executed: webhook suites tests/webhook/*.test.ts via tsx (re-run) | 2026-10-18 | | | | 45 passed, 0 failed |
| Executed: new round-3 probes (project/security-scans/round3-pglite-probes-2026-10-18.mjs/.txt) | 2026-10-18 | | | | 25 passed, 0 failed (grants, impersonation, fail-closed, GUC cleanup, rotation, ownership transfer) |
| Round 4: S-018 Closed; S-019 Reopened (Info); new S-020 (Info); D-018 reviewed, no entitlement bypass | 2026-10-18 | 0 | 0 | 0 | 1 (+3 Info) |
| Executed: PGlite tests/sql/billing-followups.test.mjs (migration 20261102 on top of all earlier ones) | 2026-10-18 | | | | 9 passed, 0 failed |
| Executed: webhook suites billing-retest.test.ts and billing-webhook.test.ts via tsx (re-run) | 2026-10-18 | | | | 24 + 26 passed, 0 failed |
| semgrep / gitleaks / osv-scanner / trivy | 2026-10-18 | n/a | n/a | n/a | n/a (not installed; targeted regex search for Stripe key/webhook patterns found only a git-ignored .env.local, see S-017) |

npm audit notes (from round 1): the 5 "high" are dev tooling pulled by `eslint-config-next`; the 2 "moderate" are `exceljs`/`uuid`. None touch billing and none ship in the production request path (exceljs should be assessed separately for exports).

## Status of round 1 findings
S-001 to S-010: all Closed (verified fixed) with file:line evidence in project/security-findings.md. S-011 (privacy policy wording) stays Open on purpose, needs legal review.

## Open risks
| ID | Severity | Summary |
|---|---|---|
| S-011 | Low | Privacy policy not updated for subscription billing (Stripe subscriptions, Resend billing and alert emails, retention) and not for the trial_claims record (pseudonymous hashes kept indefinitely; the docs wording "no individual can be identified" overstates it). Legal review. |
| S-017 | Info | Live Stripe key in local .env.local (git-ignored, untracked). |
| S-019 | Info | Reopened: docs/billing-setup.md still offers the SQL-editor set_config backfill, still says no individual can be identified / no erasure request, still calls forget_trial_claim a test helper. Log settings and secret entropy need the operator. |
| S-020 | Info | Race loser not applied when the winner died at Stripe within seconds (repaired when the owner opens Subscribe); docs stale about the billing migration being unapplied and about 20261102 and D-018. |

Closed in round 3: S-012..S-016. Closed in round 4: S-018 (evidence in project/security-findings.md).

## What was checked and found sound (round 2)
- Trial rule: trial_claims has no FK, RLS on, all API privileges revoked; verified-email gate; claim insert on the primary key serialises concurrent creations (only one wins, a rolled-back creation rolls the claim back); per-user advisory lock around the cap check; direct inserts into organizations and memberships are refused; delete-and-recreate gives no trial; Gmail dots/googlemail/+tag aliases collapse; no response tells anyone whether another email used a trial.
- Definer functions: every new one sets `search_path = ''` and uses schema-qualified names; EXECUTE revoked from public/anon (and authenticated on trigger functions and email_key); amended create_organization keeps its grants; promote_class_waitlist, move_class_booking and move_class_session check the plan; shift RPCs are SECURITY INVOKER so RLS binds them (probed).
- Read-only mode: restrictive RLS on 16 org tables plus memberships, three child tables and organizations; all `authenticated` write paths over org data are covered (policy-coverage query: only profiles and push_subscriptions, own-row tables, are not); expired owner still reads and exports; a member can still leave; the owner can still delete the team (cascade works); invitations cannot be accepted into an expired team.
- Webhook: signature first; `event.account` and wrong-mode events ignored; every subscription is re-read from Stripe with our key (event ids/metadata never trusted for state), so no SSRF (fixed Stripe host; id comes from a signed event) and no payload forgery; insert-first claim with 409 for in-flight duplicates, compare-and-set takeover after 5 minutes, release on failure; invoice events need a subscription id; 90-day purge.
- Duplicate-subscription cancel: cannot be aimed at another tenant's legitimate subscription; only Tempo's server can create subscriptions on this Stripe account, the hint is accepted only for an org with no customer or the same customer, and the branch requires both subscriptions to be live in Stripe.
- Secrets: setup script reads the key from the environment, prints only price ids, refuses live keys without `--live`; cron secret compare is constant-time and fails closed; billing actions never return raw error text; no secrets in project files or docs.
- Clickjacking, redirects, email escaping, owner-only gate on every billing action: unchanged from round 1 (sound).

## What was checked and found sound (round 3)
- create_organization_as: EXECUTE revoked from public/anon/authenticated and granted to service_role only (probes: anon and authenticated refused, so nobody can create a team for another uid or burn their trial claim); the app passes the uid from the verified session (getUser) and the action checks both TRIAL_CLAIM_SECRET and SUPABASE_SERVICE_ROLE_KEY before calling (fail closed). The old browser-callable create_organization is dropped and nothing in src, e2e, tests or scripts calls it. The service-role client is built only in src/lib/supabase/admin.ts (`server-only`); the onboarding client form imports neither it nor env; the built client chunks contain no reference to the variable or the RPC.
- Secret: not stored in tables or function bodies, not in error messages or return values, cleared from the transaction-local setting after use and after a failure; null/short secret fails closed before anything is created.
- Trial hashes: HMAC with the secret, kind-prefixed, no hash oracle through the API; rotation consequence (everyone could claim again) confirmed and documented.
- Backfill: service-role only, idempotent, fails closed; script reads from the environment only.
- Owner-promotion cap: ownership transfer, no-op writes and other updates work; only a promotion to owner of someone already owning 3 teams is refused.
- Compare-and-set reconciliation and fair rotation work in the suites; refunds are limited to the duplicate subscription's own paid invoices, are idempotent, and cannot be aimed at a legitimate payment by metadata or events.
- BILLING_ALERT_EMAIL: escaped HTML, constant sender name, JSON API call, only Stripe ids and amounts. Chunked plan lookup in runTimedWorkflows: chunks of 100, per-business fallback, fail closed for the business whose lookup fails.
- Manage-billing Portal: owner-only, customer is the business's own stored customer, return URL built from the configured app URL and an encoded slug.

## Compliance checklist
| Standard | Control | Status (Pass/Fail/N/A) | Notes |
|---|---|---|---|
| OWASP A01 | Owner-only billing, RLS on subscription tables, read-only mode enforced in database and definer RPCs | Pass | Probed as an authenticated owner of an expired team |
| OWASP A02 | Cryptography / secrets handling | Pass with Info items | HMAC-SHA256 with a server-side key, fail closed; no keys in project files; Stripe handles card data. S-017 (live key in local env), S-019 (secret handling) are Info |
| OWASP A03 | Injection | Pass | Query builder / parameterized; dynamic SQL in the migration only formats fixed table names |
| OWASP A04 | Insecure design / abuse | Pass with Low residual | S-013..S-016 and S-018 Closed; S-020 (Info) open |
| OWASP A05 | Misconfiguration / error messages | Pass | S-005 closed; confirm schema `private` is not exposed by the Data API (human) |
| OWASP A07 | Auth failures / brute force | Pass | Cron constant-time; no rate limiting on billing actions (owner-only, low risk); sign-up rate limits not reviewed |
| OWASP A08 | Integrity (webhook) | Pass | S-003 closed; do not create Payment Links for the plan prices (Info) |
| OWASP A09 | Logging | Pass | No secrets or card data in logs; duplicate alert now also emailed when BILLING_ALERT_EMAIL is set. Confirm Postgres statement logging is off for RPC parameters (S-019, human) |
| PCI DSS SAQ A | No card data in Tempo; Stripe-hosted Checkout and Portal only | Pass | Re-checked round 3: redirects to Stripe-hosted pages, no card fields or Stripe.js elements, no card data in logs or DB, refunds use Stripe ids only. Operator must complete their own SAQ A attestation (human) |
| PIPEDA | Purposes, openness, retention, access/erasure, processor agreement with Stripe | Fail | Technical minimisation done (S-012 Closed: hashes only, no ids or emails stored). Still Fail on openness: S-011 (privacy policy does not mention Stripe subscriptions, Resend billing emails, trial_claims or retention). Needs human/legal review; Stripe/Resend DPAs and cross-border disclosure to confirm |
| CASL | Billing emails are transactional | Pass (technical) | Account/subscription messages to account owners only; trial copy is factual; operator alert emails go to the operator's own address. Not legal certification |
| GDPR / HIPAA / AODA | Not listed for this feature | N/A | Billing page uses labelled inputs and aria-live regions; not tested with assistive technology |

## Not verified / needs a human
- The migration has still never been applied to a real Supabase project (the repo's .env.local points at one remote project; nothing was run against it). Deploy order matters: apply the migration, set TRIAL_CLAIM_SECRET, run scripts/backfill-trial-claims.mjs, then deploy the app (the new app calls create_organization_as, which does not exist until the migration is applied; the migration drops the old create_organization, which the old app needs).
- Real Supabase grants: default privileges on a real project differ from the PGlite stub. The migration revokes explicitly from public, anon and authenticated, which is what the probes exercised, but re-check with `df+` or the dashboard after applying.
- Postgres log settings (statement and parameter logging) for the RPC parameter that carries TRIAL_CLAIM_SECRET (S-019).
- The timestamptz equality filter used by the compare-and-set (`updated_at`) against a real PostgREST; test on staging before launch (if it never matched, plan updates would be dropped).
- Real concurrency: advisory-lock races (team creation, owner promotion), and the S-018 race, were not exercised (PGlite is single-connection).
- The migration was run in PGlite with stubbed Supabase roles, `auth.uid()` and `auth.users`, not on real Supabase. Real concurrency (two connections) was not exercised: the trial-claim race, the cap race and the staff/location limits are verified by reasoning and by single-connection tests only. Run it on a staging project and race two sessions.
- Supabase "Confirm email" must be ON in production (S-013d); `private` must not be an exposed schema (no supabase/config.toml in the repo).
- Real Stripe behaviour (Checkout expiry window, Portal configuration, `items.data[].current_period_end` and `invoice.parent.subscription_details` fields for the account's API version, Smart Retries and the unpaid/cancel setting, Stripe Tax) was not tested; nothing was run against Stripe.
- Server-action owner gates and the UI were read, not driven in a browser; e2e specs (they target the remote project) were not run.
- Legal review: privacy policy (S-011), trial_claims retention (S-012), cross-border processing by Stripe/Resend, whether the trial-ending email is purely transactional under CASL.
- semgrep, gitleaks, osv-scanner, trivy are not installed here; git history was only spot-checked for .env files.

## Round 4 (follow-ups) summary
- S-018 Closed: after a lost compare-and-set the duplicate check runs on a re-read row; cancel and refund always target the newcomer, never the row's subscription; forged, replayed or metadata-crafted events cannot aim it at a legitimate subscription (signature, account and mode checks, fresh Stripe read, lookup by stored ids first).
- D-018 sticky expiry (billing-server.ts:481-482, 495): no entitlement bypass. The row stays `expired` (billing_entitled returns false for expired) unless Stripe itself reports active/trialing (or a different, new subscription replaces it); a past_due report, a late or out-of-order event or the sweep cannot raise it. Stripe state is always re-read, so a stale event cannot reactivate a cancelled or unpaid org, and a paying org recovers on invoice.paid or on the hourly reconcile. The sticky rule matches only the same subscription id; Stripe unpaid/paused map straight to expired.
- Migration 20261102000000_billing_followups.sql: `alter function private.max_owned_orgs() set search_path = ''` (body is `select 3`, grants untouched, still revoked from public/anon/authenticated) and a COMMENT on forget_trial_claim; no new objects, grants or policies. It resolves the Supabase advisor warning function_search_path_mutable for private.max_owned_orgs once applied (NOT yet applied to production). The other advisor items (public.org_accepts_bookings executable by anon; public.billing_status by authenticated) remain and are intentional: the first returns only a boolean (false for unknown ids and expired orgs alike), the second returns null to non-members.
- Not verified here: migration on real Supabase, real concurrency, real Stripe cancel/refund, the real advisor output after applying.
