# Tempo

Scheduling for teams — a Cal.com / Fresha-style booking system with an Apple-inspired design.

- **Teams & roles** — create a team, invite people by email, Owner / Admin / Staff permissions
- **Calendar** — day view with a column per staff member, week view, tap any empty slot to book
- **Public booking page** — `yoursite.com/your-team`: service → person → time → details → done
- **Services** — duration, buffer, price, deposit, colour, in person / video / phone, who performs it
- **Availability** — weekly hours per person (split shifts supported) and time off
- **Customers** — auto-created from bookings, with visit history and private notes
- **Payments** — deposits through Stripe Connect (money goes to each team's own Stripe account)
- **Notifications** — confirmation, change, cancellation and reminder emails (Resend) and SMS (Twilio)
- **Self-service** — customers get a link to view, add to calendar (.ics) or cancel their booking
- Light & dark mode, frosted-glass materials, iOS-style controls, mobile tab bar

## Stack

Next.js 16 (App Router, Server Actions) · React 19 · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS) · Stripe · Resend

## Getting started

```bash
npm install
copy .env.example .env.local     # macOS/Linux: cp .env.example .env.local
npm run dev
```

Open http://localhost:3000, create an account, and set up your team.

`.env.example` is already pointed at your `tempo-booking` Supabase project, and the database schema is applied.
To enable emails, payments and reminders, fill in the remaining keys in `.env.local`.

> **Email confirmation:** Supabase requires new users to confirm their email. The built-in
> mailer is rate-limited (a few emails per hour). For development you can turn off
> *Confirm email* in Supabase → Authentication → Sign In / Providers → Email, or add custom SMTP.
> Also set *Site URL* to your app URL under Authentication → URL Configuration.

### Design previews (no data needed)

In development, these pages render the UI with sample data:

- `/preview/calendar` (add `?view=week`)
- `/preview/booking`
- `/preview/services`, `/preview/team`, `/preview/availability`

## Project layout

```
src/
  app/
    page.tsx                 Landing page
    (auth)/login, signup     Sign in / sign up
    onboarding/              Create a team
    invite/[token]/          Accept a team invitation
    o/[org]/                 Dashboard (calendar, bookings, customers, services, team, availability, settings)
    [slug]/                  Public booking page
    booking/[token]/         Customer's manage-booking page (+ /ics)
    api/stripe/              Webhook + Connect onboarding return
    api/cron/reminders/      Reminders, expired holds, auto-complete
  components/ui/             Design system (Button, Sheet, Segmented, Switch, List, …)
  components/app/            Dashboard pieces (sidebar, booking sheets)
  components/booking/        Public booking flow
  lib/                       Supabase clients, slot engine, formatting, notifications
supabase/migrations/         Database schema, RLS policies and RPC functions
tests/                       Slot engine tests (npm test)
```

## How booking works

1. The booking page loads the team's public profile with `get_public_org` (no customer data is exposed).
2. Busy times come from `get_public_busy`; open slots are computed in the browser (`src/lib/slots.ts`) in the **team's time zone**, DST-safe.
3. `create_public_booking` re-validates everything server-side (working hours, time off, notice, booking window), picks the least-busy eligible person for "Any available", and a Postgres exclusion constraint makes double-booking impossible.
4. If the service has a deposit and the team has connected Stripe, the booking is held as *Awaiting payment* for 30 minutes while the customer pays via Stripe Checkout; the webhook confirms it.

## Security

Every table has Row Level Security. Team members only see their own team's data; Staff can't change services, settings or roles; only the server (service role) can change payment fields. Public pages go through a small set of `security definer` functions that return only what a booking page needs.

## Deploying

1. Push to GitHub and import into Vercel.
2. Add the environment variables from `.env.example` (set `NEXT_PUBLIC_APP_URL` to your domain).
3. In Supabase → Authentication → URL Configuration, set the Site URL and add `https://yourdomain.com/auth/callback` to Redirect URLs.
4. Stripe: enable Connect, then add a webhook to `https://yourdomain.com/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `account.updated` (enable "Listen to events on Connected accounts" for `account.updated`).
5. `vercel.json` schedules `/api/cron/reminders` hourly.

## Scripts

| Command | |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm test` | Slot engine tests |
| `npm run typecheck` | TypeScript |
| `npm run db:types` | Generate Supabase types (needs `npx supabase login`) |
