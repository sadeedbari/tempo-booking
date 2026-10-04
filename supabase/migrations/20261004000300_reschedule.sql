-- Customer self-service rescheduling, gated by organizations.cancellation_window_hours
-- (the same "change or cancel until N hours before" setting used for cancelling).

-- Expose what the reschedule page needs (service + staff) in the booking payload.
create or replace function public.get_booking_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'service_id', b.service_id, 'member_id', b.member_id,
    'service_name', b.service_name, 'price_cents', b.price_cents, 'deposit_cents', b.deposit_cents,
    'currency', b.currency, 'payment_status', b.payment_status, 'notes', b.notes,
    'customer_name', c.name, 'customer_email', c.email,
    'staff_name', m.display_name,
    'location_type', s.location_type, 'location_detail', s.location_detail,
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'timezone', o.timezone,
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

revoke execute on function public.reschedule_booking_by_token(text, timestamptz) from public;
grant execute on function public.reschedule_booking_by_token(text, timestamptz) to anon, authenticated;
