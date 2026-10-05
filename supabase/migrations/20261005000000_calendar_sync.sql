-- Tempo — two-way calendar sync (Google first; provider column allows Outlook later).
-- calendar_connections holds encrypted OAuth tokens and is reachable only by the
-- service role (RLS on, no policies). external_busy mirrors the events on each
-- connected personal calendar so they block online booking slots.

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null references public.memberships (id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  external_email text,
  calendar_id text not null default 'primary',
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'needs_reauth')),
  busy_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (member_id, provider)
);
create index calendar_connections_org_idx on public.calendar_connections (org_id);
alter table public.calendar_connections enable row level security;

create table public.external_busy (
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null references public.memberships (id) on delete cascade,
  event_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  primary key (connection_id, event_id),
  check (ends_at > starts_at)
);
create index external_busy_member_time_idx on public.external_busy (member_id, starts_at);
create index external_busy_org_time_idx on public.external_busy (org_id, starts_at);
alter table public.external_busy enable row level security;

alter table public.bookings
  add column calendar_connection_id uuid references public.calendar_connections (id) on delete set null,
  add column calendar_event_id text;

create or replace function public.get_public_busy(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (member_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.member_id, b.starts_at, b.blocked_until
  from public.bookings b
  where b.org_id = p_org
    and b.starts_at < p_to and b.blocked_until > p_from
    and (b.status = 'confirmed' or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'))
    and p_to - p_from <= interval '62 days'
  union all
  select t.member_id, t.starts_at, t.ends_at
  from public.time_off t
  where t.org_id = p_org and t.starts_at < p_to and t.ends_at > p_from
    and p_to - p_from <= interval '62 days'
  union all
  select x.member_id, x.starts_at, x.ends_at
  from public.external_busy x
  where x.org_id = p_org and x.starts_at < p_to and x.ends_at > p_from
    and p_to - p_from <= interval '62 days';
$$;

create or replace function public.create_public_booking(
  p_org uuid,
  p_service uuid,
  p_member uuid,          -- null = any available staff
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_location uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_svc public.services;
  v_end timestamptz;
  v_block timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_customer uuid;
  v_booking public.bookings;
  v_candidate uuid;
  v_status public.booking_status;
  v_pay public.payment_status;
  v_has_locations boolean;
begin
  if coalesce(trim(p_name), '') = '' or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter your name and a valid email';
  end if;

  select * into v_org from public.organizations where id = p_org;
  select * into v_svc from public.services where id = p_service and org_id = p_org and active;
  if v_org.id is null or v_svc.id is null then
    raise exception 'Service not found';
  end if;

  select exists (select 1 from public.locations where org_id = p_org and active) into v_has_locations;
  if v_has_locations then
    if p_location is null or not exists (select 1 from public.locations where id = p_location and org_id = p_org and active) then
      raise exception 'Please choose a location';
    end if;
  else
    p_location := null;
  end if;

  if p_starts_at < now() + make_interval(mins => v_org.min_notice_minutes) then
    raise exception 'This time is too soon to book';
  end if;
  if p_starts_at > now() + make_interval(days => v_org.max_advance_days) then
    raise exception 'This time is too far in the future';
  end if;

  v_end := p_starts_at + make_interval(mins => v_svc.duration_minutes);
  v_block := v_end + make_interval(mins => v_svc.buffer_after_minutes);
  v_local_start := p_starts_at at time zone v_org.timezone;
  v_local_end := v_end at time zone v_org.timezone;

  -- Release abandoned unpaid holds so they don't block the slot.
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed'
  where org_id = p_org and status = 'pending_payment' and created_at < now() - interval '30 minutes';

  -- Pick the staff member: the requested one, or the first free eligible one.
  select m.id into v_candidate
    from public.memberships m
    where m.org_id = p_org and m.bookable
      and (p_member is null or m.id = p_member)
      and (
        not exists (select 1 from public.service_staff ss where ss.service_id = v_svc.id)
        or exists (select 1 from public.service_staff ss where ss.service_id = v_svc.id and ss.member_id = m.id)
      )
      and (
        p_location is null
        or not exists (select 1 from public.member_locations ml where ml.location_id = p_location)
        or exists (select 1 from public.member_locations ml where ml.location_id = p_location and ml.member_id = m.id)
      )
      and v_local_start::date = v_local_end::date
      and exists (
        select 1 from public.availability_rules r
        where r.member_id = m.id
          and r.weekday = extract(dow from v_local_start)::int
          and r.start_time <= v_local_start::time
          and r.end_time >= v_local_end::time
      )
      and not exists (
        select 1 from public.time_off t
        where t.member_id = m.id and t.starts_at < v_block and t.ends_at > p_starts_at
      )
      and not exists (
        select 1 from public.bookings b
        where b.member_id = m.id and b.status in ('confirmed', 'pending_payment')
          and b.starts_at < v_block and b.blocked_until > p_starts_at
      )
      and not exists (
        select 1 from public.external_busy x
        where x.member_id = m.id and x.starts_at < v_block and x.ends_at > p_starts_at
      )
    order by (
      select count(*) from public.bookings b2
      where b2.member_id = m.id and b2.status = 'confirmed'
        and b2.starts_at::date = p_starts_at::date
    ), m.created_at
    limit 1;

  if v_candidate is null then
    raise exception 'Sorry, that time was just taken. Please pick another.';
  end if;

  insert into public.customers (org_id, name, email, phone)
  values (p_org, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''))
  on conflict (org_id, email) do update
    set name = excluded.name, phone = coalesce(excluded.phone, public.customers.phone)
  returning id into v_customer;

  if v_svc.deposit_cents > 0 and v_org.stripe_charges_enabled then
    v_status := 'pending_payment';
    v_pay := 'pending';
  else
    v_status := 'confirmed';
    v_pay := 'none';
  end if;

  begin
    insert into public.bookings (
      org_id, service_id, member_id, location_id, customer_id, starts_at, ends_at, blocked_until,
      status, service_name, notes, price_cents, deposit_cents, currency, payment_status, source
    ) values (
      p_org, v_svc.id, v_candidate, p_location, v_customer, p_starts_at, v_end, v_block,
      v_status, v_svc.name, nullif(trim(p_notes), ''), v_svc.price_cents, v_svc.deposit_cents,
      v_org.currency, v_pay, 'online'
    ) returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another.';
  end;

  return jsonb_build_object(
    'id', v_booking.id,
    'manage_token', v_booking.manage_token,
    'status', v_booking.status,
    'member_id', v_booking.member_id
  );
end;
$$;

create or replace function public.reschedule_booking_by_token(p_token text, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_org public.organizations;
  v_svc public.services;
  v_end timestamptz;
  v_block timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_candidate uuid;
begin
  select * into v_b from public.bookings where manage_token = p_token and length(p_token) >= 32 for update;
  if v_b.id is null then
    raise exception 'Booking not found';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception 'This booking can no longer be rescheduled';
  end if;

  select * into v_org from public.organizations where id = v_b.org_id;
  if v_b.starts_at < now() + make_interval(hours => v_org.cancellation_window_hours) then
    raise exception 'Online rescheduling has closed for this booking. Please contact the business.';
  end if;

  select * into v_svc from public.services where id = v_b.service_id and active;
  if v_svc.id is null then
    raise exception 'This service is no longer available. Please contact the business.';
  end if;

  if p_starts_at < now() + make_interval(mins => v_org.min_notice_minutes) then
    raise exception 'This time is too soon to book';
  end if;
  if p_starts_at > now() + make_interval(days => v_org.max_advance_days) then
    raise exception 'This time is too far in the future';
  end if;

  v_end := p_starts_at + make_interval(mins => v_svc.duration_minutes);
  v_block := v_end + make_interval(mins => v_svc.buffer_after_minutes);
  v_local_start := p_starts_at at time zone v_org.timezone;
  v_local_end := v_end at time zone v_org.timezone;

  -- Prefer the same person; otherwise anyone eligible who is free.
  select m.id into v_candidate
    from public.memberships m
    where m.org_id = v_b.org_id and m.bookable
      and (
        not exists (select 1 from public.service_staff ss where ss.service_id = v_svc.id)
        or exists (select 1 from public.service_staff ss where ss.service_id = v_svc.id and ss.member_id = m.id)
      )
      and (
        v_b.location_id is null
        or not exists (select 1 from public.member_locations ml where ml.location_id = v_b.location_id)
        or exists (select 1 from public.member_locations ml where ml.location_id = v_b.location_id and ml.member_id = m.id)
      )
      and v_local_start::date = v_local_end::date
      and exists (
        select 1 from public.availability_rules r
        where r.member_id = m.id
          and r.weekday = extract(dow from v_local_start)::int
          and r.start_time <= v_local_start::time
          and r.end_time >= v_local_end::time
      )
      and not exists (
        select 1 from public.time_off t
        where t.member_id = m.id and t.starts_at < v_block and t.ends_at > p_starts_at
      )
      and not exists (
        select 1 from public.bookings b
        where b.member_id = m.id and b.id <> v_b.id and b.status in ('confirmed', 'pending_payment')
          and b.starts_at < v_block and b.blocked_until > p_starts_at
      )
      and not exists (
        select 1 from public.external_busy x
        where x.member_id = m.id and x.starts_at < v_block and x.ends_at > p_starts_at
      )
    order by (m.id = v_b.member_id) desc, m.created_at
    limit 1;

  if v_candidate is null then
    raise exception 'Sorry, that time was just taken. Please pick another.';
  end if;

  begin
    update public.bookings
    set starts_at = p_starts_at, ends_at = v_end, blocked_until = v_block,
        member_id = v_candidate, reminder_sent_at = null
    where id = v_b.id;
  exception when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another.';
  end;

  return jsonb_build_object('id', v_b.id, 'starts_at', p_starts_at);
end;
$$;

revoke execute on function public.get_public_busy(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid) from public;
revoke execute on function public.reschedule_booking_by_token(text, timestamptz) from public;
grant execute on function public.get_public_busy(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.reschedule_booking_by_token(text, timestamptz) to anon, authenticated;
