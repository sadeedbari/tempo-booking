-- Tempo — changing group classes after people have booked (phase 3a).
--
--   * class_sessions.series_id / series_index: sessions created together ("every week, 8 times") share a series, so the
--     team can change or cancel "this and all later sessions" at once.
--   * move_class_booking(): moves one person to another session of the same class (capacity, duplicates and the clock
--     are checked under locks).
--   * move_class_session(): moves a session to a new time and/or instructor, and everyone booked into it moves with it.
--
-- A class spot normally can't be moved, and a booked session can't be rescheduled (so nothing slips by accident).
-- These two functions are the deliberate way: they raise a transaction-local flag (tempo.move) that the guards honour.

alter table public.class_sessions
  add column series_id uuid,
  add column series_index int;
create index class_sessions_series_idx on public.class_sessions (series_id, starts_at) where series_id is not null;

-- ───────────────────────── Guards honour tempo.move ─────────────────────────
create or replace function private.bookings_class_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.class_sessions;
begin
  if tg_op = 'UPDATE' and old.session_id is not null and coalesce(current_setting('tempo.move', true), '') <> '1' then
    if new.session_id is distinct from old.session_id or new.member_id is distinct from old.member_id
       or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
       or new.blocked_until is distinct from old.blocked_until then
      raise exception 'A class booking can''t be moved. Cancel it and book another session.';
    end if;
  end if;

  if new.session_id is not null then
    select * into v_s from public.class_sessions where id = new.session_id for update;
    if v_s.id is null or v_s.org_id <> new.org_id then
      raise exception 'This class is no longer available.';
    end if;
    if tg_op = 'INSERT' then
      new.member_id := v_s.member_id;
      new.starts_at := v_s.starts_at;
      new.ends_at := v_s.ends_at;
      new.blocked_until := v_s.blocked_until;
      new.location_id := v_s.location_id;
      new.service_id := v_s.service_id;
    end if;
    if new.status in ('confirmed', 'pending_approval', 'pending_payment') and (tg_op = 'INSERT' or old.status not in ('confirmed', 'pending_approval', 'pending_payment')) then
      if v_s.status <> 'scheduled' then
        raise exception 'This class has been cancelled.';
      end if;
      if (select count(*) from public.bookings b
          where b.session_id = new.session_id and b.id <> new.id
            and (b.status in ('confirmed', 'pending_approval')
                 or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'))) >= v_s.capacity then
        raise exception 'This class is full.';
      end if;
    end if;
  elsif new.status in ('confirmed', 'pending_approval', 'pending_payment') and new.member_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.member_id::text, 0));
    if exists (
      select 1 from public.class_sessions cs
      where cs.member_id = new.member_id and cs.status = 'scheduled'
        and cs.starts_at < new.blocked_until and cs.blocked_until > new.starts_at
    ) then
      raise exception 'That time overlaps a class this person is teaching.' using errcode = 'exclusion_violation';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.class_sessions_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_active int;
begin
  if new.status = 'scheduled' then
    if not exists (select 1 from public.services where id = new.service_id and org_id = new.org_id and is_class) then
      raise exception 'Choose a class service for this session.';
    end if;
    if not exists (select 1 from public.memberships where id = new.member_id and org_id = new.org_id) then
      raise exception 'Choose someone from your team to lead this session.';
    end if;
    if new.location_id is not null and not exists (select 1 from public.locations where id = new.location_id and org_id = new.org_id) then
      raise exception 'Choose one of your locations.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_active := private.session_taken(old.id);
    if new.status = 'scheduled' and v_active > 0 and coalesce(current_setting('tempo.move', true), '') <> '1' and (
         new.member_id is distinct from old.member_id or new.starts_at is distinct from old.starts_at
         or new.ends_at is distinct from old.ends_at or new.blocked_until is distinct from old.blocked_until) then
      raise exception 'People are booked into this session. Cancel it instead of moving it.';
    end if;
    if new.status = 'scheduled' and new.capacity < v_active then
      raise exception '% people are already booked, so the capacity can''t go below %.', v_active, v_active;
    end if;
    if new.status = 'cancelled' and old.status = 'scheduled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
  end if;

  if new.status = 'scheduled' then
    perform pg_advisory_xact_lock(hashtextextended(new.member_id::text, 0));
    if exists (
      select 1 from public.bookings b
      where b.member_id = new.member_id and b.session_id is null
        and b.status in ('confirmed', 'pending_payment', 'pending_approval')
        and b.starts_at < new.blocked_until and b.blocked_until > new.starts_at
    ) then
      raise exception 'That person already has a booking at that time.' using errcode = 'exclusion_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ───────────────────────── Move one person to another session ─────────────────────────
create function public.move_class_booking(p_booking uuid, p_session uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.bookings;
  v_from public.class_sessions;
  v_to public.class_sessions;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if v_b.id is null or v_b.session_id is null then
    raise exception 'This isn''t a class booking.';
  end if;
  if not private.is_org_member(v_b.org_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if v_b.status not in ('confirmed', 'pending_approval') then
    raise exception 'Only a booked spot can be moved.';
  end if;
  if v_b.session_id = p_session then
    raise exception 'That person is already in this session.';
  end if;

  -- both sessions locked in a fixed order, so two moves at once can't deadlock
  perform 1 from public.class_sessions where id in (v_b.session_id, p_session) order by id for update;
  select * into v_from from public.class_sessions where id = v_b.session_id;
  select * into v_to from public.class_sessions where id = p_session and org_id = v_b.org_id;
  if v_from.starts_at <= now() then
    raise exception 'That class has already started, so the spot can''t be moved.';
  end if;
  if v_to.id is null or v_to.status <> 'scheduled' then
    raise exception 'That session isn''t available.';
  end if;
  if v_to.service_id <> v_b.service_id then
    raise exception 'Choose a session of the same class.';
  end if;
  if v_to.starts_at <= now() then
    raise exception 'That session has already started.';
  end if;
  if exists (
    select 1 from public.bookings x
    where x.session_id = v_to.id and x.customer_id = v_b.customer_id and x.customer_id is not null
      and x.status in ('confirmed', 'pending_approval', 'pending_payment')
  ) then
    raise exception 'That person is already in that session.';
  end if;
  if private.session_taken(v_to.id) >= v_to.capacity then
    raise exception 'That session is full.';
  end if;

  perform set_config('tempo.move', '1', true);
  update public.bookings
  set session_id = v_to.id, member_id = v_to.member_id, location_id = v_to.location_id,
      starts_at = v_to.starts_at, ends_at = v_to.ends_at, blocked_until = v_to.blocked_until,
      reminder_sent_at = null
  where id = v_b.id;
  perform set_config('tempo.move', '', true);

  return jsonb_build_object('booking_id', v_b.id, 'from_session', v_from.id, 'to_session', v_to.id);
end;
$$;

-- ───────────────────────── Move a session (and everyone in it) ─────────────────────────
create function public.move_class_session(p_session uuid, p_starts_at timestamptz, p_member uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.class_sessions;
  v_dur interval;
  v_buf interval;
  v_end timestamptz;
  v_ids uuid[];
begin
  select * into v_s from public.class_sessions where id = p_session for update;
  if v_s.id is null then
    raise exception 'Session not found.';
  end if;
  if not private.is_org_member(v_s.org_id) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  if v_s.status <> 'scheduled' then
    raise exception 'This session has been cancelled.';
  end if;
  if v_s.starts_at <= now() then
    raise exception 'This session has already started, so it can''t be moved.';
  end if;
  if p_starts_at <= now() then
    raise exception 'Pick a time in the future.';
  end if;

  v_dur := v_s.ends_at - v_s.starts_at;
  v_buf := v_s.blocked_until - v_s.ends_at;
  v_end := p_starts_at + v_dur;

  perform set_config('tempo.move', '1', true);
  update public.class_sessions
  set starts_at = p_starts_at, ends_at = v_end, blocked_until = v_end + v_buf,
      member_id = coalesce(p_member, v_s.member_id)
  where id = v_s.id;

  with moved as (
    update public.bookings
    set member_id = coalesce(p_member, v_s.member_id), starts_at = p_starts_at, ends_at = v_end, blocked_until = v_end + v_buf,
        reminder_sent_at = null
    where session_id = v_s.id and status in ('confirmed', 'pending_approval', 'pending_payment')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  perform set_config('tempo.move', '', true);

  return jsonb_build_object('session_id', v_s.id, 'booking_ids', to_jsonb(v_ids));
end;
$$;

revoke execute on function public.move_class_booking(uuid, uuid) from public, anon;
revoke execute on function public.move_class_session(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.move_class_booking(uuid, uuid) to authenticated;
grant execute on function public.move_class_session(uuid, timestamptz, uuid) to authenticated;
