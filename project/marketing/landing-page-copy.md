# Tempo landing page copy (refresh)

Status: DRAFT for owner approval. Nothing here is published. Prepared 2026-10-18 for `src/app/page.tsx`.
Sources read: `project/landing-page-requirements.md`, `src/app/page.tsx`, `src/lib/billing.ts`, `docs/billing-setup.md`, `README.md`, `src/app/privacy/page.tsx`, `src/lib/legal.ts`, `src/app/manifest.ts`, `public/sw.js`, plus the app files listed in section 4.
Note: `project/seo-plan.md` is empty (no keyword map yet), so the keyword set in section 3 follows the brief and the requirements. The `seo` agent should confirm it.
Note: I had no shell tool, so I could not run `git log`. Feature dates come from `project/status.md` and the requirements.

---

## 1. Voice and tone

- Calm, clear, friendly. Talk to one business owner ("you"), not a "team of stakeholders".
- Short sentences. One idea per line. Plain words: "book" not "schedule an engagement", "text" not "SMS" (use "text message" in body copy).
- Canadian spelling: colour, centre, favourite, cancelled (one "l" is also accepted, keep it consistent with the app: "cancelled").
- Examples across several trades: salon, clinic, studio, classes, consultant, mobile service. Never one industry only.
- Say what it does, not how clever it is. No "revolutionary", "AI-powered", "seamless", "best-in-class".
- Never use: "unlimited", "guaranteed", "100%", "HIPAA", "PHIPA", "PIPEDA compliant", uptime numbers, awards, customer counts, logos, quotes.
- Money is always "$15 CAD" or "$15/month" with "CAD" on first mention in each section.
- Headings are sentences or short phrases. No exclamation marks.
- Keep what the current page already does well: warm, short, Apple-like restraint. The existing H1 stays.

---

## 2. Section-by-section copy

### 2.1 Header
| Element | Signed out | Signed in |
|---|---|---|
| Anchor link 1 | Features (`#features`) | Features |
| Anchor link 2 | Pricing (`#pricing`) | Pricing |
| Anchor link 3 (optional) | FAQ (`#faq`) | FAQ |
| Text link | Sign in (`/login`) | (hidden) |
| Button | Get started (`/signup`) | Open Tempo (`/app`) |

On phones keep only the logo, theme slider and the button. Anchor links may collapse.

### 2.2 Hero
- Eyebrow: **Online booking for service businesses**
- H1 (keep): **Booking, made effortless.** (gradient on "effortless.")
  - Alternates if the owner wants a change: "Take bookings. Skip the back and forth." / "Your calendar, your booking page, your clients. One calm place."
- Subhead: **Tempo is online booking software for salons, clinics, studios, classes and mobile services. Take appointments and classes, collect deposits and send reminders.**
  - Shorter phone version: **Online booking for salons, clinics, studios, classes and mobile services. Deposits and reminders included.**
- Primary CTA (exact): **Get started free** (signed in: **Go to your calendar**)
- Secondary CTA (exact): **See what's inside** (`#features`)
- Trial line (under the CTAs, exact): **14-day free trial. No credit card required.**
- Product preview alt text: see section 3.
- Preview caption (optional, small): *Illustration. Names and bookings are examples.*

### 2.3 Proof strip (one line, verifiable only)
**14-day free trial** · **No credit card to start** · **Prices in Canadian dollars** · **Cancel any time**

(Each item is in `src/lib/billing.ts` / `docs/billing-setup.md`. No customer numbers or logos.)

### 2.4 Features

Section title (H2): **Everything you need to run your day.**
Section intro: **Simple tools for booking, teams, classes and getting paid.**

Icons are from `lucide-react`. Names marked (in repo) are already imported somewhere in `src/`. The rest are standard lucide names; the developer should confirm each resolves in the installed version.

#### Group A. Book (H3: "Take bookings")
Intro: **A calendar for you and a page for your customers.**

| Title | Body (max 20 words) | Icon |
|---|---|---|
| A calendar you'll enjoy | Day and week views with a column for each person. Tap an empty slot to add a booking. | `CalendarDays` (in repo) |
| Your booking page | One link where customers pick a service, a person and a time. Share it anywhere. | `Link2` (in repo) |
| Repeat appointments | Customers book every 1 to 4 weeks in one go. One confirmation lists every date. | `Repeat` (in repo) |
| Questions per service | Ask what you need to know before the visit. Answers appear with the booking. | `ClipboardList` (in repo) |
| Customer addresses | For mobile services. Ask for an address, optional or required, with a unit or apartment field. | `MapPin` (in repo) |
| Approve requests | Choose which services need your OK. Online bookings wait until you confirm them. | `CircleCheck` |
| Self-service links | Customers can view, add to their calendar, or cancel their booking from a link. | `CalendarPlus` |

#### Group B. Classes (H3: "Run group classes")
Intro: **For yoga, workshops, lessons and anything people book together.**

| Title | Body | Icon |
|---|---|---|
| Classes with spots | Set how many spots each session has. Customers book one or more, with guest names. | `Users` (in repo) |
| Weekly classes | Add a class every week in one step. Change or cancel one session or all later ones. | `Repeat` (in repo) |
| Roster and walk-ins | See who is coming, add walk-ins and mark who showed up. | `ClipboardList` (in repo) |
| Move or cancel | Move one person or a whole session. Customers are told about the change. | `ArrowRightLeft` (in repo) |
| Automatic waitlist | When a class is full, customers join the waitlist. A free spot books them in automatically. | `Hourglass` (in repo) |

#### Group C. Team and locations (H3: "Grow your team")
Intro: **Add people and places when you are ready.**

| Title | Body | Icon |
|---|---|---|
| Roles for your team | Owners, admins and staff each see and change only what they should. | `Users2` (in repo) |
| Staff without a login | Add people who never sign in. You manage their hours. Invite them later if you like. | `UserPlus` (in repo) |
| Weekly hours and shifts | Set weekly hours or plan shifts by week or month. Copy last week in one tap. | `CalendarRange` (in repo) |
| Multiple locations | Each location gets its own schedule and team. Customers choose where to book. | `Building2` |
| Two-places warning | Get a warning when someone is scheduled at two locations at the same time. | `AlertTriangle` (in repo) |

#### Group D. Get paid and stay in touch (H3: "Get paid, stay in touch")
Intro: **Deposits, reminders and messages in your own words.**

| Title | Body | Icon |
|---|---|---|
| Deposits with Stripe | Take a deposit when customers book. It goes straight to your own Stripe account. | `CreditCard` (in repo) |
| Reminders | Confirmations and reminders by email, and by text for customers who agree to texts. | `BellRing` (in repo) |
| Your own wording | Write your own customer emails and texts. Choose when each one sends. | `Workflow` (in repo) |
| Booking alerts | Get a phone or computer alert when a booking is made, requested, changed or cancelled. | `Bell` |

#### Group E. Your website (H3: "Work with your website")
Intro: **Let visitors book or ask a question without leaving your site.**

| Title | Body | Icon |
|---|---|---|
| Book from your site | Add a pop-up or floating Book now button with one line of code. | `Globe` |
| Website contact form | Use a hosted page, a pop-up or a form right on your page. | `MessageSquareText` (in repo) |
| One inbox | Messages arrive in Inquiries. You get a notice, and the sender becomes a customer. | `Inbox` (in repo) |
| Message to booking | Turn a message into a booking in one tap. Senders can get an automatic thank-you. | `CalendarPlus` |

#### Group F. Run the business (H3: "Keep it simple")
Intro: **Know how the week is going, then get back to work.**

| Title | Body | Icon |
|---|---|---|
| Home dashboard | See today, key numbers and a setup checklist with a progress ring. | `House` (in repo) |
| Excel export | Download Home, Customers and Schedule as Excel files. | `Download` (in repo) |
| Customer records | Customers are added from bookings, with visit history and private notes. | `Contact` (in repo) |
| Install on your phone | Add Tempo to your iPhone or Android home screen. It opens like an app. | `Smartphone` |
| Light or dark | Choose light, dark, or follow your device. | `SunMoon` |
| Private by design | Each team's data is kept separate by database-level rules. | `ShieldCheck` (in repo) |

Optional extra (include only if the owner confirms Google and Outlook calendar sync is switched on in production, see section 5):
| Calendar sync | Connect your own Google or Outlook calendar. Bookings appear there and busy times are not offered. | `CalendarSync` |

### 2.5 Pricing

- H2: **One simple price.**
- Subhead: **Start with a 14-day free trial. No credit card required. Then $15 CAD a month, and add only what you need.**
- Trial line (repeat here, exact): **14-day free trial. No credit card required.**

**Plan card**
- Plan name: **Tempo**
- Price: **$15 CAD / month**
- Includes:
  - 1 location
  - 5 staff
  - Everything on this page
- Button: **Get started free** (signed in: **Go to your calendar**)
- Under button: **14-day free trial. No credit card required.**
- Trial detail (small): **The trial includes 1 location and 5 staff. One trial per person.**

**Add-ons**
1. **Extra location: +$15/month.** Includes 5 more staff.
2. **Extra staff pack: +$5/month.** Adds 5 more staff, shared across your whole business.

**Estimator**
- Title: **Work out your price**
- Label 1: **Extra locations** (stepper, 0 to 20)
- Label 2: **Extra staff packs (5 staff each)** (stepper, 0 to 40)
- Stepper aria-labels: "Add one extra location", "Remove one extra location", "Add one extra staff pack", "Remove one extra staff pack"
- Result lines (live region):
  - **Your plan: {n} location(s), {m} staff**
  - **{price} CAD per month**
- Helper text: **Everyone on your team counts as staff, with or without a login. A location that is switched off does not count.**
- Footnote: **Prices are in Canadian dollars. Locations and staff are limited to what your plan includes.**
- Formula (developer: import constants from `src/lib/billing.ts`, do not copy): total = 15 + 15 x extra locations + 5 x staff packs. Locations = 1 + extra. Staff = 5 x locations + 5 x packs.

**Three worked examples** (verified against `monthlyCents` and `planLimits`)
| Example | Extra locations | Extra packs | Locations | Staff | Price |
|---|---|---|---|---|---|
| A solo studio or small team | 0 | 0 | 1 | 5 | $15/month |
| 2 locations, 10 staff | 1 | 0 | 2 | 10 | $30/month |
| 2 locations, 15 staff | 1 | 1 | 2 | 15 | $35/month |
| 3 locations, 25 staff | 2 | 2 | 3 | 25 | $55/month |

(The requirements list three examples: $30, $35, $55. The $15 row is the base plan and may be shown as the card itself.)

Example captions:
- **2 locations and 10 staff: $30 a month.** (a second studio or clinic)
- **2 locations and 15 staff: $35 a month.** (a growing team)
- **3 locations and 25 staff: $55 a month.** (a small group of locations)

**What happens after the trial**
- Title: **After your trial**
- Text: **We email you 3 days before it ends. If you don't subscribe, your dashboard becomes view-only and your booking page pauses. Nothing is deleted. You can still view and export your data. Subscribe and everything comes back right away.**
- Same wording applies if a payment fails and is not fixed in 7 days (see FAQ).

**Cancel**
- Text: **Cancel any time. You keep access until the end of the period you paid for.**

### 2.6 FAQ
H2: **Questions, answered.**
Each answer is short. Developer: use real `<details>`/accordion, one open at a time is optional.

1. **How does the free trial work?**
   You get 14 days from the day you create your team. The trial includes 1 location and 5 staff. There is one free trial per person.

2. **Do I need a credit card to start?**
   No. You only add payment details when you choose to subscribe. Card details are handled by Stripe and never stored by Tempo.

3. **Can I cancel any time?**
   Yes. Cancel from your billing page. You keep access until the end of the period you paid for, and you can change your mind before then.

4. **What happens when my trial ends or a payment fails?**
   Your dashboard becomes view-only and your booking page pauses, so no new bookings come in. Nothing is deleted. If a payment fails, you have 7 days to fix it first. Subscribe or update your card and everything returns right away. Customers can still change or cancel a booking they already made.

5. **Can I add locations or staff later?**
   Yes. Add an extra location for $15/month (it includes 5 more staff) or a staff pack for $5/month (5 more staff). If you reach your limit, Tempo shows you what to add. Upgrades are charged pro rata.

6. **Who can see billing?**
   Only the owner. Admins and staff see whether the plan is active and who to ask, but not prices, dates or payment details.

7. **What happens to my data and my customers' data?**
   Each business's data is kept separate from every other business. Tempo does not sell personal information or use it for advertising. Deposits are paid on Stripe's secure page, and Tempo never sees or stores card numbers. You can ask to see, correct or delete information by emailing info@sulosystems.com. Read the full Privacy Policy for the service providers Tempo uses.

8. **Which kinds of businesses use Tempo?**
   Tempo is built for salons, clinics, studios, classes, consultants and mobile services. It is not a medical records system, so please do not store clinical notes in it.
   *(Owner decision: see Questions. Remove this answer if you do not want to make a clinical statement.)*

Link text under the FAQ: **Still unsure? Email us at info@sulosystems.com.**

### 2.7 Final CTA
- H2: **Ready for calmer bookings?**
- Body: **Set up your team in a few minutes and see how it feels. No credit card needed.**
  - If the owner does not want a time claim, use: **Create your team and see how it feels. No credit card needed.**
- Button: **Get started free** (signed in: **Go to your calendar**)
- Under button: **14-day free trial. No credit card required.**

### 2.8 Footer
- Links: **Privacy Policy** (`/privacy`) · **Terms of Service** (`/terms`) · **Contact** (`mailto:info@sulosystems.com`)
- Line: **© {year} Tempo, by Sulo Systems. Made with care.**

---

## 3. SEO block

- **Page title** (53 characters): `Tempo: Online Booking Software for Service Businesses`
- **Meta description** (140 characters): `Online booking, group classes, reminders and deposits for salons, clinics, studios and more. From $15 CAD/month. 14-day free trial, no card.`
- **Open Graph title:** `Tempo: online booking that feels effortless`
- **Open Graph description:** `Take appointments and classes, send reminders and collect deposits. 14-day free trial. No credit card required.`
- **Twitter card:** same as Open Graph (summary_large_image only if the developer adds a real image).
- **Primary keyword set** (natural use; the H1 stays "Booking, made effortless", keywords go in the eyebrow, subhead, H2/H3s and FAQ):
  1. online booking software
  2. appointment scheduling for small business
  3. class booking and waitlist
  4. booking page for your website (secondary)
  5. online booking with deposits (secondary)
  Where they already appear: 1 in hero subhead and title; 2 in the Group A intro and FAQ; 3 in Group B title and waitlist line; 4 and 5 in Groups E and D.
- **Product preview alt text:** `Illustration of the Tempo calendar showing one day with appointments for three team members.`
- **Canonical:** `https://tempo.sulosystems.com/`
- **JSON-LD offer facts (exact):**
  - `@type`: `SoftwareApplication` (category `BusinessApplication`), with `Organization` publisher "Sulo Systems"
  - `offers.@type`: `Offer`
  - `offers.price`: `15` (string or number, no `$` sign)
  - `offers.priceCurrency`: `CAD`
  - Billing period: monthly. Use `priceSpecification` of type `UnitPriceSpecification` with `price` 15, `priceCurrency` CAD, `billingDuration` 1, `unitCode` `MON` (or `billingPeriod`/"P1M" if the developer prefers).
  - Description of the offer: `Base plan with 1 location and 5 staff. 14-day free trial, no credit card required.`
  - Do NOT add `aggregateRating`, `review`, `award`, or any count of users.

---

## 4. Claim to code evidence

> 2026-10-22: the features section is now four big benefit blocks (booking, classes and waitlist, deposits and reminders, your website) with a described illustration each, then one compact "And everything else" list (Grow your team, Run the business). The wording of every line below is unchanged; only where it appears moved. The four h3 headings keep their search phrases.


Paths are relative to the repo root. "Read" means I opened and read the file for the claim.

| Claim on the page | Evidence checked |
|---|---|
| $15 base, +$15 location, +$5 pack, 5 staff per location and per pack, CAD, 14-day trial, trial limits 1 location and 5 staff, 7-day grace, limits 20 locations and 40 packs | `src/lib/billing.ts` (`BASE_CENTS`, `LOCATION_CENTS`, `PACK_CENTS`, `STAFF_PER_*`, `TRIAL_DAYS`, `TRIAL_LIMITS`, `GRACE_DAYS`, `MAX_*`, `monthlyCents`, `planLimits`) |
| Examples $30 / $35 / $55 | `monthlyCents` and `planLimits` worked by hand; also `project/requirements.md` section 2 and `tests/TEST-PLAN.md` |
| No card for trial; trial starts when team created; one trial per person; second team starts without a trial | `docs/billing-setup.md` "Trials and teams"; `project/requirements.md` section 9 |
| After trial or unpaid: view-only dashboard, booking page paused, nothing deleted, subscribing restores | `docs/billing-setup.md` "What happens"; `project/status.md`; `tests/TEST-PLAN.md` spec 26 |
| Customers can still cancel or reschedule an existing booking while paused | `project/status.md` (D-009 decision), `tests/TEST-PLAN.md` |
| Cancel at period end, access continues, can resume | `docs/billing-setup.md`; `src/lib/billing.ts` (`cancel_at_period_end`, `isEntitled`); `tests/TEST-PLAN.md` |
| Email 3 days before trial ends | `docs/billing-setup.md` "Emails"; `project/requirements.md` F9 (not read in `billing-server.ts`) |
| Only owners see billing details | `docs/billing-setup.md` last safety-net bullet; `src/app/o/[org]/settings/view.tsx` (billing card owner-only) |
| Upgrades prorated, one-click add-on when at a limit | `project/requirements.md` F4/F5; `src/lib/billing.ts` (`upgradeFor`); `src/app/o/[org]/team/view.tsx` (`UpgradeNotice`) |
| Calendar with day and week views, a column per person, tap a slot to book | `README.md`; `src/app/page.tsx` (existing claim); sidebar `src/components/app/sidebar.tsx`. I did not open the calendar view file. |
| Public booking page: service, person, time, details | `src/components/booking/booking-flow.tsx` (steps `location`, `service`, `staff`, `time`, `details`) |
| Repeat every 1 to 4 weeks, one confirmation lists dates | `src/components/booking/booking-flow.tsx` (repeat selects 1 to 4 weeks, date preview); `src/app/o/[org]/services/view.tsx` ("every 1 to 4 weeks, up to 26 times") |
| Questions per service, answers with the booking | `src/components/booking/booking-flow.tsx` (`collectAnswers`, `IntakeFields`); `src/app/o/[org]/services/view.tsx` (`QuestionsEditor`); `src/app/privacy/page.tsx` ("stored with that booking, visible to the business and its team") |
| Customer address off/optional/required; unit field | `src/app/o/[org]/services/view.tsx` (`address_mode`); `src/components/booking/booking-flow.tsx` (`unit` field) |
| Address suggestions | `src/components/ui/address-input.tsx` (Google Places autocomplete; falls back to a plain box with no key). Not stated in the copy. |
| Approve requests per service | `src/app/o/[org]/services/view.tsx` ("Automatically approve bookings"); `src/lib/workflow-defaults.ts` ("Any deposit has been refunded") |
| Customer self-service: view, add to calendar, cancel | `src/app/booking/[token]/ics/route.ts`; `README.md`; `tests/TEST-PLAN.md` (customer cancel/reschedule) |
| Group classes with spots; several spots per booking (max 6) with guest names | `src/components/booking/booking-flow.tsx` (`spots`, `maxSpots = min(6, ...)`, `guests`); `src/app/o/[org]/services/view.tsx` (class switch, capacity) |
| Weekly repeat of sessions; change or cancel this and later sessions | `src/components/app/new-session-sheet.tsx` (`repeat_weeks`, `repeat_count`); `src/components/app/session-sheet.tsx` (`getSessionSeries`, `updateSession`, `cancelSession`) |
| Roster, walk-ins, attendance | `src/components/app/session-sheet.tsx` (`getSessionRoster`, `addSessionAttendee`, `setBookingStatus`) |
| Move a person or a session | `src/components/app/session-sheet.tsx` (`moveAttendee`, `moveSession`, `getMoveTargets`) |
| Waitlist, automatic booking when a spot opens | `src/components/booking/booking-flow.tsx` (`joinWaitlist`, notice text "booked in automatically"); `src/components/app/session-sheet.tsx` (`getSessionWaitlist`); `tests/TEST-PLAN.md` (waitlist join and auto-promote) |
| Roles owner/admin/staff | `src/app/o/[org]/team/view.tsx` (`ROLE_LABEL`, role selects) |
| Staff without a login; invite later | `src/app/o/[org]/team/view.tsx` ("Team members don't have to sign in", "Invite to sign in") |
| Weekly hours; shifts by week or month; copy previous; fill from weekly hours | `src/app/o/[org]/schedule/view.tsx` (week/month, `copySchedule`, `fillFromWeeklyHours`); sidebar has Availability |
| Multiple locations, schedule per location, customers choose a location | `src/app/o/[org]/schedule/view.tsx` (location tabs); `src/components/booking/booking-flow.tsx` (`location` step) |
| Two-places warning | `src/app/o/[org]/schedule/view.tsx` (`crossLocationOverlaps`, warning text) |
| Deposits via Stripe, paid to the business's own account | `src/app/o/[org]/settings/view.tsx` ("Funds go straight to your Stripe account"); `src/app/privacy/page.tsx`; `README.md` |
| Email reminders; text for customers who agree | `src/lib/workflow-defaults.ts` (email and SMS steps, `before_start`); `src/components/booking/booking-flow.tsx` (SMS consent checkbox); `src/app/o/[org]/settings/view.tsx` |
| Write your own messages, choose timing, activity log | `src/app/o/[org]/workflows/view.tsx` ("written your way", `describeTrigger`, Activity tab) |
| Booking alerts (made, requested, rescheduled, cancelled) | `src/app/o/[org]/settings/view.tsx` (`notify_push` hint); `public/sw.js` (push handler) |
| Booking pop-up and floating button | `src/app/o/[org]/settings/embed.tsx` (`data-tempo-open`, `data-floating`) |
| Contact form: hosted page, pop-up, inline | `src/app/o/[org]/settings/contact-embed.tsx` (kinds `popup`, `inline`, `link`) |
| Inquiries inbox, notified, sender becomes a customer, create booking, automatic confirmation | `src/app/o/[org]/inquiries/view.tsx` ("Create booking" link); `src/app/o/[org]/settings/contact-embed.tsx` and `view.tsx` (notice, customer created); `src/app/privacy/page.tsx` ("automatic email confirming it was received, if the business has that message turned on") |
| Home dashboard with setup progress ring | `src/app/o/[org]/dashboard/view.tsx`; `src/app/o/[org]/dashboard/setup-progress.tsx` (ring and percent) |
| Excel export of Home, Customers, Schedule | Links in `dashboard/view.tsx` (`/api/export/home`), `customers/view.tsx` (`/api/export/customers`), `schedule/view.tsx` (`/api/export/schedule`); `package.json` (`exceljs`). I did not open the export route files. |
| Customer records with visit history and notes | `src/app/o/[org]/customers/view.tsx`; `README.md` |
| Installable on phone | `src/app/manifest.ts` (`display: standalone`, icons); `public/sw.js` |
| Light, dark, system | `src/app/layout.tsx` (theme script); `src/app/o/[org]/settings/view.tsx` ("Light, dark, or follow your device") |
| Private by design (separation by database rules) | `src/app/privacy/page.tsx` Security section; `README.md` Security |
| Privacy FAQ: do not sell, no advertising, card numbers never seen, deletion on request, providers | `src/app/privacy/page.tsx` ("We do not sell personal information", "We never see or store card numbers", "Your choices and rights", providers list) |
| Privacy and contact email, operator | `src/lib/legal.ts` (Sulo Systems, info@sulosystems.com) |
| Calendar sync (optional extra) | `src/app/privacy/page.tsx` (Google and Microsoft calendar section); `src/app/api/google/callback/route.ts`; `.env.example`. Depends on production settings. |

---

## 5. Unverified claims removed and open questions

### Unverified claims removed (not on the page)
1. "Double-booking is impossible." `README.md` says a Postgres exclusion constraint does this, but I could not open or list `supabase/migrations/` to confirm. Also, the app allows one person to be scheduled at two locations at once (with a warning), so the claim would be misleading.
2. "Intake answers appear in customer emails and in the Excel export." The requirements list this, but I only confirmed answers are stored with the booking and visible to the team. I did not find the email or export code.
3. "Push alerts work on iPhone" or any iOS-specific push claim. The service worker and manifest exist, but I did not verify iOS behaviour.
4. "Set up in minutes" or any time-to-set-up claim in the final CTA (offered as optional with a fallback). No test or measurement backs it.
5. "Your data is stored in Canada" or any location-of-data claim. The privacy policy names Supabase and Vercel but gives no region.
6. Any statement about Stripe fees, card networks, sales tax or GST/HST on the subscription. Tax depends on `STRIPE_BILLING_AUTOMATIC_TAX`, which is off by default.
7. Compliance claims: HIPAA, PHIPA, PIPEDA, GDPR, SOC 2, PCI certification. None are made.
8. "Unlimited" anything, uptime or speed numbers, awards, testimonials, customer counts, logos, ratings, integrations beyond Stripe, Google/Outlook calendar (optional) and the website embeds.
9. "Works offline." The service worker shows an offline notice only; it does not cache pages.
10. "Made in Canada" / "Canadian company." The operator is Sulo Systems, but its location is not in the code.
11. "Automatic text messages for everyone." Texts depend on customer consent and on SMS being switched on for the platform (`features.sms`). The copy says "for customers who agree to texts".

### Questions for the owner
1. **SMS and push:** are text reminders (Twilio) and booking push alerts switched on in production? If not, soften the Reminders and Booking alerts lines or hold them back (the app itself says "isn't available yet" when they are off).
2. **Google Places address suggestions:** is `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` set in production? The copy only says "ask for an address", so no change is needed either way. Say yes if you want "with suggestions as they type" added.
3. **Calendar sync:** are Google Calendar and Outlook sync live (client IDs, token key set)? If yes, add the optional "Calendar sync" feature.
4. **Stripe Tax:** will GST/HST be added to subscriptions? If yes, add "Taxes are added at checkout where they apply" under the price. If no, say nothing.
5. **Data location and retention:** can you state where data is hosted (Supabase and Vercel regions)? The privacy policy does not, so the FAQ does not say. Billing and trial-claim wording in the policy is also still open (S-011).
6. **FAQ 8** ("not a medical records system"): do you want to make this statement? It is a cautious one, not a compliance claim. Remove it if unsure.
7. **Preview graphic:** the stylised preview uses made-up names (Maya, Jordan, Aisha, "Lumen Studio"). OK to keep, with the caption "Illustration"?
8. **Add-on limits:** the app caps extra locations at 20 and extra packs at 40, and a person can own at most 3 teams. Do you want these shown in the estimator footnote? I left them out of marketing copy but the estimator should stop at those numbers.
9. **Existing pages:** `src/app/layout.tsx` still has the old title ("Scheduling, beautifully simple") and description. The page-level metadata in section 3 should override them; confirm.
10. **Real proof:** do you have real quotes, logos or numbers you can share? None are invented. If yes, add a labelled placeholder such as `[CUSTOMER QUOTE: pending approval from <name>]`.
11. **SEO keyword map:** `project/seo-plan.md` is empty. Please have the `seo` agent confirm or replace the keyword set.
