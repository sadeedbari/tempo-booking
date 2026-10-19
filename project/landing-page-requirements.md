# Requirements: Tempo landing page refresh

> Status: user answered the three open decisions on 2026-10-18. Build starts after the billing UI retest finishes (the developer must not edit `src/` while the tester is running e2e).

## 1. Overview
- **Page:** the public home page at `https://tempo.sulosystems.com/` (`src/app/page.tsx`).
- **Goal:** the page was written on 2026-10-04 and last touched 2026-10-12. It lists 6 features and says "Create your team: free". Bring it up to date with everything added since, and show pricing.
- **Audience:** owners of service businesses (salons, clinics, studios, fitness and classes, consultants, mobile services). General, not one industry.
- **Market:** Canada first (prices in CAD), English.

## 2. Decisions (user, 2026-10-18)
- **Pricing section:** plan card plus a small interactive estimator.
- **Primary call to action:** "Get started free". Under it, a short line that makes the trial terms clear: "14-day free trial. No credit card required." Pricing is shown further down the page so "free" is never read as "free forever".
- **Copy:** general service businesses, with examples across several.

## 3. Facts the page must state accurately
- **Price:** $15 CAD/month includes 1 location and 5 staff. Each extra location is +$15/month and includes 5 more staff. Each extra pack of 5 staff is +$5/month, shared across the business.
- **Examples:** 2 locations and 10 staff = $30. 2 locations and 15 staff = $35. 3 locations and 25 staff = $55.
- **Trial:** 14 days, no credit card, starts when the team is created. Trial includes 1 location and 5 staff. One trial per person.
- **After the trial or if payment fails:** the dashboard becomes view-only and the public booking page pauses. Nothing is deleted. Subscribing restores it immediately.
- **Cancel:** any time; access continues to the end of the paid period.
- Do not claim anything that is not built. No claims about HIPAA/PHIPA compliance, uptime guarantees, "unlimited" anything, or integrations that don't exist. Every feature line must be traceable to code (the marketing agent verifies each against `src/` and `supabase/migrations/`).

## 4. Features to cover (shipped since the page was written, plus the originals)
Originals: calendar (day/week, per-staff columns), public booking page, teams with roles, deposits and payments with Stripe, automatic reminders by email and SMS, private by design.
Added since:
- Installable web app (PWA) for iPhone and Android, and push notifications for new, requested, rescheduled and cancelled bookings.
- Home dashboard with a setup progress ring, and Excel export for Home, Customers and Schedule.
- Approve booking requests per service.
- Workflows: businesses write their own customer emails and texts.
- Customer addresses for mobile businesses (off/optional/required per service), with Google Places autocomplete and a unit/apartment field.
- Team members without a login (invitation optional).
- Multiple locations, with a schedule per location and a warning when one person is at two places at once.
- Website contact form: hosted page, pop-up and inline embed, an Inquiries inbox, email and push alerts, automatic customer creation, create a booking from a message, confirmation to the sender.
- Intake questions per service, with answers shown to the team, in customer emails and in the Excel export.
- Recurring appointments (every 1 to 4 weeks), one confirmation listing all dates.
- Group classes: sessions with capacity, customers book spots (several spots per booking with guest names), weekly repeat, roster with attendance, walk-ins, move or cancel a session and tell everyone, and a waitlist that books people in automatically when a spot opens.
- Light, dark and system appearance.
- Subscription billing: plan, trial, upgrade and manage billing in the app.

## 5. Page structure (proposed; copy by the marketing agent, layout by the developer)
1. Header: logo, theme slider, anchor links (Features, Pricing), Sign in, Get started.
2. Hero: headline, subhead, primary CTA "Get started free" and secondary "See what's inside", trial line, product preview.
3. Trust strip or one-line proof points (no invented testimonials, logos or numbers).
4. Feature sections grouped by theme (not a flat list of 20): Book (calendar, booking page, recurring, intake, address), Classes (group classes, waitlist), Team and locations, Get paid and stay in touch (deposits, reminders, workflows, push), Your website (contact form and embeds), Run the business (Home, export, approvals, PWA, privacy). Each with an icon and 1 to 2 lines.
5. Pricing: plan card, add-ons, interactive estimator (locations and extra staff packs, shows monthly total and what is included), 14-day trial note, what happens after the trial.
6. FAQ (a short, accurate set: trial, card, cancel, what happens when the trial ends, can I add locations or staff later, data privacy).
7. Final CTA.
8. Footer: Privacy Policy, Terms of Service, contact.

## 6. Acceptance criteria
- [ ] Every shipped feature in section 4 appears on the page, grouped sensibly, with copy that matches the code.
- [ ] Pricing numbers match `src/lib/billing.ts` exactly. The estimator uses the same price constants (imported from `src/lib/billing.ts`, not duplicated) and gives $15, $30, $35 and $55 for the examples in section 3.
- [ ] The primary CTA reads "Get started free" and the trial line "14-day free trial. No credit card required." is visible near it and in the pricing section.
- [ ] Signed-in visitors still see "Open Tempo" / "Go to your calendar" instead of the sign-up buttons.
- [ ] **Mobile first:** no horizontal scroll at 320, 375, 390, 768, 1024 and 1280 px; tap targets at least 44x44 px; readable text (at least 16px body); the header does not overflow (the theme slider, sign-in and CTA fit at 320px or collapse sensibly); the product preview scales or is simplified on phones; the estimator is usable with a thumb (large steppers, not tiny inputs); sticky header does not cover anchor targets; images and gradients do not cause layout shift.
- [ ] Accessible: WCAG 2.1 AA contrast in light and dark, one h1, ordered headings, visible focus, all controls labelled, the estimator announces changes in a live region and works by keyboard, reduced-motion respected.
- [ ] SEO: unique title and meta description, Open Graph and Twitter tags, `Organization`/`SoftwareApplication` JSON-LD with the real offer price (CAD), canonical URL, sitemap and robots unchanged or improved, headings use real keywords naturally, page weight small (no heavy images, no new dependencies unless justified), Lighthouse performance and accessibility at least 90 on mobile.
- [ ] No new third-party scripts or trackers. No invented testimonials, customer logos, statistics or awards.
- [ ] Existing behaviour unchanged: sign-in/out state, the theme slider, links to /signup, /login, /privacy and /terms.
- [ ] Browser tests (Playwright) for the page at phone and desktop widths, including the estimator and no horizontal scroll, added under `e2e/specs/`.

## 7. Out of scope
New brand identity, logo changes, blog, multi-language, customer testimonials, screenshots of the real app (a stylised preview is fine), changing the privacy policy or terms text.

## 8. Open questions
- Does the privacy policy need to mention billing before launch? (Tracked as S-011, legal review; the landing page does not change it.)
- Any real customer quotes, logos or numbers to show? (None are invented.)

## 9. Owner answers to the copy questions (2026-10-18)
- SMS reminders and push notifications are switched on in production: the page may say reminders by email and text, and push notifications on phones.
- Google/Outlook calendar sync is live: the page may mention it.
- Stripe Tax is NOT on: prices exclude tax. The pricing section says "Prices in CAD, plus applicable taxes where required."
- Include the FAQ answer that Tempo is a scheduling tool and not a medical records system.
- Copy source: `project/marketing/landing-page-copy.md` (claims checked against code by the marketing agent; the `seo` agent must confirm the keyword set; page-level metadata overrides the old title/description in `src/app/layout.tsx`).
