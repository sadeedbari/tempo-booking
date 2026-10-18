# Requirements – Tempo subscription billing

> Status: DRAFT, awaiting user approval (2026-10-17). Decisions in section 9 were confirmed by the user.

## 1. Overview
- **One-line description:** A paid subscription for Tempo businesses, priced by locations and staff, with a 14-day free trial that needs no credit card.
- **Problem it solves:** Tempo has no way to charge the businesses that use it.
- **Target users / audience:** Business owners and admins who run a Tempo organization. Only owners manage billing.
- **Market / location:** Canada (CAD assumed, see open questions). English.

## 2. Pricing model
| Item | Price | Includes |
|---|---|---|
| Base plan | $15/month | 1 location, 5 staff |
| Extra location | +$15/month each | +5 staff included with that location |
| Extra staff pack | +$5/month per pack | +5 staff, shared across the whole business |

- Staff limit = (locations x 5) + (staff packs x 5).
- Location limit = 1 + extra locations.
- Examples: 1 location / 5 staff = $15. 2 locations / 10 staff = $30. 2 locations / 15 staff = $35.

## 3. Features
| # | Feature | Description | Priority |
|---|---|---|---|
| F1 | Free trial | Every organization gets a 14-day trial with no card. Trial limit: 1 location, 5 staff. Existing organizations get a fresh 14 days from release. | Must |
| F2 | Subscribe | Owner picks locations and staff packs, pays through Stripe Checkout (hosted, card details never touch Tempo). Subscription is monthly. | Must |
| F3 | Billing page | In Settings: plan, status, trial days left, locations and staff used vs allowed, next invoice, invoices, change plan, cancel. Stripe Customer Portal for card and invoices. | Must |
| F4 | Add or remove add-ons | Owner can add or remove locations and staff packs. Upgrades are prorated immediately. Downgrades are blocked while usage is above the new limit. | Must |
| F5 | Limit enforcement | Adding a location or staff member beyond the limit is blocked in the app AND in the database, with an upgrade prompt. | Must |
| F6 | Trial/expiry handling | Trial banner with days left. After the trial or a cancelled/unpaid subscription: dashboard read-only (view and export data, subscribe), public booking page paused with a neutral "not accepting bookings" message. Nothing is deleted. | Must |
| F7 | Stripe webhooks | Keep subscription state in sync (created, updated, cancelled, payment failed, trial ending). Signature-verified and idempotent. | Must |
| F8 | Failed payment | Stripe retries. Owner is emailed. After a grace period (7 days) the org moves to the expired state. | Must |
| F9 | Emails | Trial ending in 3 days, trial ended, payment failed, subscription started or changed. | Should |
| F10 | Cancel | Owner cancels at period end. Access continues to the end of the paid period. Can resume before then. | Must |

## 4. User flows
1. **New org:** sign up -> trial starts automatically -> banner shows days left -> owner subscribes from Settings > Billing at any time.
2. **Subscribe:** Billing page -> choose locations and staff packs -> Stripe Checkout -> return to Billing page showing active plan.
3. **Hit a limit:** owner adds a 6th staff member -> blocked with "Your plan includes 5 staff. Add 5 more for $5/month" -> confirm -> subscription updated, prorated -> staff member added.
4. **Trial ends:** trial expires with no subscription -> dashboard read-only, booking page paused -> owner subscribes -> everything restored immediately.
5. **Payment fails:** Stripe retries, owner emailed, 7-day grace, then expired state until card fixed in the portal.
6. **Cancel:** Billing page -> cancel -> active until period end -> then expired state.

## 5. Acceptance criteria
- [ ] F1: Given a new organization, when it is created, then it has a trial ending 14 days later and no Stripe customer or card is required.
- [ ] F1: Given an existing organization, when the release runs, then its trial ends 14 days after release.
- [ ] F2: Given a trial org, when the owner completes Checkout for 1 location and 0 packs, then status is active and the price is $15/month.
- [ ] F2: Given 3 locations and 2 packs selected, then the price is $15 + 2x$15 + 2x$5 = $55/month and limits are 3 locations, 25 staff.
- [ ] F4: Given 6 staff on a 5-staff plan, when the owner tries to remove a pack, then it is refused with a clear reason.
- [ ] F5: Given a plan at its location limit, when any client (UI, API or direct database call) inserts a location, then it is rejected.
- [ ] F5: Only owners can see or change billing. Admins and members cannot, and cannot call the billing endpoints.
- [ ] F6: Given an expired org, then bookings cannot be created through the public page, the API or embed, and the dashboard cannot create or edit anything.
- [ ] F7: Given a replayed or forged webhook, then state is unchanged (idempotent, signature checked).
- [ ] F8: Given a failed payment, then the owner is emailed and after 7 days the org is expired.
- [ ] F10: Given a cancelled subscription, then access continues until the period end, not before.
- [ ] Existing customer-deposit payments (Stripe Connect) keep working unchanged.

## 6. Non-functional requirements
- **Platforms:** web, mobile web.
- **Performance:** the entitlement check must not noticeably slow booking pages (cache or single indexed read).
- **Accessibility:** WCAG 2.1 AA / AODA.
- **Languages:** English.

## 7. Compliance standards that apply
- [x] OWASP Top 10 (webhook signature verification, owner-only authorization, server-side price calculation, never trust client quantities)
- [x] PIPEDA
- [x] PCI DSS (SAQ A: Stripe Checkout and Customer Portal only, no card data in Tempo)
- [x] CASL (billing emails are transactional)
- [ ] GDPR / HIPAA: not applicable unless the user says otherwise

## 8. Tech preferences and integrations
- **Stack:** existing: Next.js 16, Supabase (Postgres + RLS), Stripe SDK, Resend for email.
- **Stripe:** Tempo's own platform Stripe account for subscriptions (Products: base, extra location, staff pack). This is separate from the existing Stripe Connect flow that collects customer deposits for each business.
- **Source of truth:** Stripe for billing. A local `subscriptions` record per organization, updated only by webhooks, for fast checks and database-level limits.
- **New env vars (names only, no values in files):** a webhook signing secret and three Stripe price IDs.

## 9. Decisions confirmed by the user (2026-10-17)
- Staff packs are shared across the whole business.
- After trial end: dashboard read-only, public booking paused, nothing deleted.
- Trial limits: 1 location, 5 staff. Existing organizations get a fresh 14-day trial.
- Over the limit: blocked with an upgrade prompt, one-click add-on, prorated.
- **Trial farming (decided 2026-10-18):** one free trial per owner, tied to the verified email (normalised: case, "+tag", Gmail dots) and kept even if the team is deleted. A later team by the same person starts with no trial (view-only until it subscribes). Existing teams count as their owner's trial. A user with an unverified email gets no trial (nothing is recorded). At most 3 teams per owner (constant `MAX_OWNED_ORGS` / `private.max_owned_orgs()`), enforced in the database and the UI.

## 10. Out of scope
- Annual billing, discount codes, per-seat metering beyond packs, tax invoices beyond what Stripe provides, refunds UI (handled in the Stripe dashboard), changes to the customer deposit flow.

## 11. Open questions (defaults assumed unless you say otherwise)
1. **Currency:** assumed CAD. Confirm.
2. **What counts as staff:** assumed every membership, including team members without a login and non-bookable ones. Counting only bookable staff would be more generous.
3. **Sales tax (HST/GST):** assumed handled by Stripe Tax if enabled in your account. Needs your Stripe setup.
4. **Stripe account:** the subscription Products and prices and the webhook endpoint must be created in your Stripe account (test mode first). The developer can write a setup script, but you must provide the keys.
5. ~~Unlimited free trials~~ resolved in section 9 (one trial per owner, 3 teams per owner).
6. **Deactivated locations:** assumed an inactive location does not count toward the limit.
