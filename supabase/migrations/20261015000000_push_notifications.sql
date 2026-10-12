-- Tempo — push notifications for staff when a booking is made, requested, rescheduled or cancelled.
-- Each team can turn them off (on by default); each person turns them on per device.

alter table public.organizations
  add column notify_push boolean not null default true;
comment on column public.organizations.notify_push is 'Send push notifications to owners/admins and the booked team member about new, requested, rescheduled and cancelled bookings.';

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- People manage only their own devices. Sending uses the service role, which bypasses RLS.
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
