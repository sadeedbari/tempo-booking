-- Tempo — move policy helpers to a private schema and add the public booking API.
-- Public (signed-out) customers only ever touch the database through the
-- security-definer functions below, which expose no customer data.

create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_org_member(uuid) set schema private;
alter function public.has_org_role(uuid, public.org_role[]) set schema private;
alter function public.member_org(uuid) set schema private;
alter function public.is_self_member(uuid) set schema private;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- guard_role_change referenced public.has_org_role by name; recreate it.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id then
    raise exception 'Membership team and user cannot be changed';
  end if;
  if new.role is distinct from old.role then
    if (select auth.uid()) is not null and not private.has_org_role(new.org_id, array['owner']::public.org_role[])
       and (new.role = 'owner' or old.role = 'owner') then
      raise exception 'Only owners can change owner roles';
    end if;
    if (select auth.uid()) is not null and not private.has_org_role(new.org_id, array['owner','admin']::public.org_role[]) then
      raise exception 'Not allowed to change roles';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_role_change() from public, anon, authenticated;

-- ───────────────────────── Public: booking page data ─────────────────────────
create or replace function public.get_public_org(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org', jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'description', o.description,
      'timezone', o.timezone, 'currency', o.currency, 'accent_color', o.accent_color,
      'logo_url', o.logo_url, 'address', o.address, 'phone', o.phone, 'website', o.website,
      'min_notice_minutes', o.min_notice_minutes, 'max_advance_days', o.max_advance_days,
      'slot_interval_minutes', o.slot_interval_minutes,
      'cancellation_window_hours', o.cancellation_window_hours,
      'payments_enabled', o.stripe_charges_enabled
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description, 'kind', s.kind,
        'duration_minutes', s.duration_minutes, 'buffer_after_minutes', s.buffer_after_minutes,
        'price_cents', s.price_cents, 'deposit_cents', s.deposit_cents, 'color', s.color,
        'location_type', s.location_type,
        'staff_ids', coalesce((select jsonb_agg(ss.member_id) from public.service_staff ss where ss.service_id = s.id), '[]'::jsonb)
      ) order by s.position, s.created_at)
      from public.services s where s.org_id = o.id and s.active
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'display_name', m.display_name, 'title', m.title, 'color', m.color,
        'avatar_url', p.avatar_url
      ) order by m.created_at)
      from public.memberships m
      left join public.profiles p on p.id = m.user_id
      where m.org_id = o.id and m.bookable
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', r.member_id, 'weekday', r.weekday,
        'start_time', to_char(r.start_time, 'HH24:MI'), 'end_time', to_char(r.end_time, 'HH24:MI')
      ))
      from public.availability_rules r
      join public.memberships m on m.id = r.member_id and m.bookable
      where r.org_id = o.id
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = lower(p_slug);
$$;

-- Busy intervals (bookings + time off) for a team, without any customer details.
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
    and p_to - p_from <= interval '62 days';
$$;

-- ───────────────────────── Public: create a booking ─────────────────────────
create or replace function public.create_public_booking(
  p_org uuid,
  p_service uuid,
  p_member uuid,          -- null = any available staff
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_notes text
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
begin
  if coalesce(trim(p_name), '') = '' or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter your name and a valid email';
  end if;

  select * into v_org from public.organizations where id = p_org;
  select * into v_svc from public.services where id = p_service and org_id = p_org and active;
  if v_org.id is null or v_svc.id is null then
    raise exception 'Service not found';
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
      org_id, service_id, member_id, customer_id, starts_at, ends_at, blocked_until,
      status, service_name, notes, price_cents, deposit_cents, currency, payment_status, source
    ) values (
      p_org, v_svc.id, v_candidate, v_customer, p_starts_at, v_end, v_block,
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

-- ───────────────────────── Public: manage a booking by token ─────────────────────────
create or replace function public.get_booking_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'service_name', b.service_name, 'price_cents', b.price_cents, 'deposit_cents', b.deposit_cents,
    'currency', b.currency, 'payment_status', b.payment_status, 'notes', b.notes,
    'customer_name', c.name, 'customer_email', c.email,
    'staff_name', m.display_name,
    'location_type', s.location_type, 'location_detail', s.location_detail,
    'org', jsonb_build_object('name', o.name, 'slug', o.slug, 'timezone', o.timezone,
      'address', o.address, 'phone', o.phone, 'accent_color', o.accent_color,
      'cancellation_window_hours', o.cancellation_window_hours)
  )
  from public.bookings b
  join public.organizations o on o.id = b.org_id
  left join public.customers c on c.id = b.customer_id
  left join public.memberships m on m.id = b.member_id
  left join public.services s on s.id = b.service_id
  where b.manage_token = p_token and length(p_token) >= 32;
$$;

create or replace function public.cancel_booking_by_token(p_token text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_window int;
begin
  select * into v_b from public.bookings where manage_token = p_token and length(p_token) >= 32;
  if v_b.id is null then
    raise exception 'Booking not found';
  end if;
  if v_b.status not in ('confirmed', 'pending_payment') then
    raise exception 'This booking can no longer be cancelled';
  end if;
  select cancellation_window_hours into v_window from public.organizations where id = v_b.org_id;
  if v_b.starts_at < now() + make_interval(hours => v_window) then
    raise exception 'Online cancellation has closed for this booking. Please contact the business.';
  end if;
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(trim(p_reason), '')
  where id = v_b.id;
end;
$$;

revoke execute on function public.get_public_org(text) from public;
revoke execute on function public.get_public_busy(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
revoke execute on function public.get_booking_by_token(text) from public;
revoke execute on function public.cancel_booking_by_token(text, text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;
grant execute on function public.get_public_busy(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.get_booking_by_token(text) to anon, authenticated;
grant execute on function public.cancel_booking_by_token(text, text) to anon, authenticated;
