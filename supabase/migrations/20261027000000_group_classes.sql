-- Tempo — group classes (phase 2a: data, rules, and the customer-facing booking).
--
-- A class is a scheduled session with a capacity ("Yoga, Tue 6pm, 8 spots, Sara"). Customers book a spot in a session
-- instead of picking a free time. Each spot is an ordinary booking row that points at its session (bookings.session_id),
-- so reminders, the manage page, cancelling, intake answers, payments and exports keep working per person.
--
--   * services.is_class / class_capacity: the service is sold as sessions, with this default capacity.
--   * class_sessions: the session itself. It holds the instructor's time (no two sessions overlap for one person).
--   * bookings_no_overlap now only covers one-on-one bookings. Class spots share an instructor and a time on purpose.
--   * Triggers (one advisory lock per person) keep sessions and one-on-one bookings from overlapping, and keep a
--     session within its capacity no matter who books (customer, team, walk-in).
--   * get_public_sessions / create_public_session_booking: the customer's list of sessions and "book a spot".
--   * One-on-one booking, rescheduling and the public busy times learn about sessions.

alter table public.services
  add column is_class boolean not null default false,
  add column class_capacity int not null default 10 check (class_capacity between 1 and 500);
comment on column public.services.is_class is 'Sold as scheduled sessions with a capacity (a group class) instead of free time slots.';

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  -- the instructor
  member_id uuid not null references public.memberships (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,
  capacity int not null check (capacity between 1 and 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  notes text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (blocked_until >= ends_at),
  constraint class_sessions_no_overlap exclude using gist (
    member_id with =, tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status = 'scheduled')
);
create index class_sessions_org_time_idx on public.class_sessions (org_id, starts_at);
create index class_sessions_service_idx on public.class_sessions (service_id, starts_at);

alter table public.bookings add column session_id uuid references public.class_sessions (id) on delete set null;
create index bookings_session_idx on public.bookings (session_id) where session_id is not null;

-- Class spots share an instructor and a time, so only one-on-one bookings are held to "one at a time".
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist (
  member_id with =, tstzrange(starts_at, blocked_until, '[)') with &&
) where (status in ('pending_payment', 'confirmed', 'pending_approval') and session_id is null);

alter table public.class_sessions enable row level security;
create policy "class sessions: members read" on public.class_sessions for select to authenticated
  using (private.is_org_member(org_id));
create policy "class sessions: members insert" on public.class_sessions for insert to authenticated
  with check (private.is_org_member(org_id));
create policy "class sessions: members update" on public.class_sessions for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "class sessions: admins delete" on public.class_sessions for delete to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- ───────────────────────── Rules ─────────────────────────

-- Spots in use: confirmed, awaiting approval, or a payment hold made in the last 30 minutes.
create function private.session_taken(p_session uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.bookings b
  where b.session_id = p_session
    and (b.status in ('confirmed', 'pending_approval')
         or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'));
$$;

-- Bookings: class spots take their time and instructor from the session, can't be moved, and can't exceed capacity.
-- One-on-one bookings can't overlap a class the person teaches.
create function private.bookings_class_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.class_sessions;
begin
  if tg_op = 'UPDATE' and old.session_id is not null then
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
create trigger bookings_class_guard before insert or update on public.bookings
  for each row execute function private.bookings_class_guard();

-- Sessions: right organisation, no clash with one-on-one bookings, capacity never below who's booked, and no moving
-- a session people have booked (cancel it instead).
create function private.class_sessions_guard() returns trigger
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
    if new.status = 'scheduled' and v_active > 0 and (
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
create trigger class_sessions_guard before insert or update on public.class_sessions
  for each row execute function private.class_sessions_guard();

-- ───────────────────────── The booking form's data ─────────────────────────
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.get_public_org(text)'::regprocedure);
  patched := replace(def, $q$'allow_series', s.allow_series,$q$, $q$'allow_series', s.allow_series, 'is_class', s.is_class, 'class_capacity', s.class_capacity,$q$);
  if patched = def then raise exception 'get_public_org was not patched'; end if;
  execute patched;

  -- one-on-one booking: classes are booked by session, and a person teaching a class isn't free then
  def := pg_get_functiondef('public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid,text,jsonb)'::regprocedure);
  patched := replace(def, $q$  v_address := nullif(left(trim(coalesce(p_address, '')), 300), '');$q$,
    $q$  if v_svc.is_class then
    raise exception 'This is a class. Please choose a session.';
  end if;

  v_address := nullif(left(trim(coalesce(p_address, '')), 300), '');$q$);
  if patched = def then raise exception 'create_public_booking (class) was not patched'; end if;
  def := patched;
  patched := replace(def, $q$where x.member_id = m.id and x.starts_at < v_block and x.ends_at > p_starts_at$q$,
    $q$where x.member_id = m.id and x.starts_at < v_block and x.ends_at > p_starts_at
      ) and not exists (
        select 1 from public.class_sessions cs
        where cs.member_id = m.id and cs.status = 'scheduled' and cs.starts_at < v_block and cs.blocked_until > p_starts_at$q$);
  if patched = def then raise exception 'create_public_booking (busy) was not patched'; end if;
  execute patched;

  -- rescheduling: a class spot can't be moved, and a class blocks the instructor
  def := pg_get_functiondef('public.reschedule_booking_by_token(text,timestamptz)'::regprocedure);
  patched := replace(def, $q$  select * into v_org from public.organizations where id = v_b.org_id;$q$,
    $q$  if v_b.session_id is not null then
    raise exception 'A class booking can''t be moved. Cancel it and book another session.';
  end if;

  select * into v_org from public.organizations where id = v_b.org_id;$q$);
  if patched = def then raise exception 'reschedule_booking_by_token (class) was not patched'; end if;
  def := patched;
  patched := replace(def, $q$where x.member_id = m.id and x.starts_at < v_block and x.ends_at > p_starts_at$q$,
    $q$where x.member_id = m.id and x.starts_at < v_block and x.ends_at > p_starts_at
      ) and not exists (
        select 1 from public.class_sessions cs
        where cs.member_id = m.id and cs.status = 'scheduled' and cs.starts_at < v_block and cs.blocked_until > p_starts_at$q$);
  if patched = def then raise exception 'reschedule_booking_by_token (busy) was not patched'; end if;
  execute patched;

  -- the manage page needs to know a booking is a class spot
  def := pg_get_functiondef('public.get_booking_by_token(text)'::regprocedure);
  patched := replace(def, $q$'id', b.id, 'status', b.status,$q$, $q$'id', b.id, 'session_id', b.session_id, 'status', b.status,$q$);
  if patched = def then raise exception 'get_booking_by_token was not patched'; end if;
  execute patched;
end $$;

-- Sessions hold the instructor's time for the public availability, like any other busy time.
create or replace function public.get_public_busy(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(member_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select b.member_id, b.starts_at, b.blocked_until
  from public.bookings b
  where b.org_id = p_org
    and b.session_id is null
    and b.starts_at < p_to and b.blocked_until > p_from
    and (b.status in ('confirmed', 'pending_approval') or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'))
    and p_to - p_from <= interval '62 days'
  union all
  select cs.member_id, cs.starts_at, cs.blocked_until
  from public.class_sessions cs
  where cs.org_id = p_org and cs.status = 'scheduled'
    and cs.starts_at < p_to and cs.blocked_until > p_from
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

-- ───────────────────────── Customers: the list of sessions ─────────────────────────
-- Upcoming sessions with how many are booked. Never who.
create function public.get_public_sessions(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(id uuid, service_id uuid, member_id uuid, location_id uuid, starts_at timestamptz, ends_at timestamptz, capacity int, booked int, notes text)
language sql stable security definer set search_path = ''
as $$
  select cs.id, cs.service_id, cs.member_id, cs.location_id, cs.starts_at, cs.ends_at, cs.capacity,
         private.session_taken(cs.id), cs.notes
  from public.class_sessions cs
  join public.services s on s.id = cs.service_id and s.active and s.is_class
  where cs.org_id = p_org and cs.status = 'scheduled'
    and cs.starts_at > now()
    and cs.starts_at < p_to and cs.ends_at > p_from
    and p_to - p_from <= interval '120 days'
  order by cs.starts_at;
$$;

-- ───────────────────────── Customers: book a spot ─────────────────────────
create function public.create_public_session_booking(
  p_org uuid,
  p_session uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_answers jsonb default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org public.organizations;
  v_s public.class_sessions;
  v_svc public.services;
  v_customer uuid;
  v_booking public.bookings;
  v_status public.booking_status;
  v_pay public.payment_status;
  v_answers jsonb;
begin
  if coalesce(trim(p_name), '') = '' or trim(coalesce(p_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(trim(p_email)) > 254 then
    raise exception 'Please enter your name and a valid email';
  end if;

  select * into v_org from public.organizations where id = p_org;
  if v_org.id is null then
    raise exception 'Class not found';
  end if;

  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed'
  where org_id = p_org and status = 'pending_payment' and created_at < now() - interval '30 minutes';

  -- the session row is locked, so two people can't take the last spot
  select * into v_s from public.class_sessions where id = p_session and org_id = p_org for update;
  if v_s.id is null or v_s.status <> 'scheduled' then
    raise exception 'This class is no longer available.';
  end if;
  select * into v_svc from public.services where id = v_s.service_id and org_id = p_org and active and is_class;
  if v_svc.id is null then
    raise exception 'This class is no longer available.';
  end if;
  if v_s.starts_at <= now() then
    raise exception 'This class has already started.';
  end if;
  if v_s.starts_at > now() + make_interval(days => v_org.max_advance_days) then
    raise exception 'This time is too far in the future';
  end if;

  v_answers := public.build_intake_answers(v_svc.id, p_answers);

  if exists (
    select 1 from public.bookings b join public.customers c on c.id = b.customer_id
    where b.session_id = v_s.id and c.email = lower(trim(p_email))
      and b.status in ('confirmed', 'pending_approval', 'pending_payment')
  ) then
    raise exception 'You''re already booked into this class.';
  end if;
  if private.session_taken(v_s.id) >= v_s.capacity then
    raise exception 'Sorry, this class is full.';
  end if;

  insert into public.customers (org_id, name, email, phone)
  values (p_org, left(trim(p_name), 120), lower(trim(p_email)), nullif(left(trim(p_phone), 40), ''))
  on conflict (org_id, email) do update
    set name = excluded.name, phone = coalesce(excluded.phone, public.customers.phone)
  returning id into v_customer;

  if v_svc.deposit_cents > 0 and v_org.stripe_charges_enabled then
    v_status := 'pending_payment';
    v_pay := 'pending';
  elsif not v_svc.auto_approve then
    v_status := 'pending_approval';
    v_pay := 'none';
  else
    v_status := 'confirmed';
    v_pay := 'none';
  end if;

  insert into public.bookings (
    org_id, service_id, member_id, location_id, customer_id, starts_at, ends_at, blocked_until, session_id,
    status, service_name, notes, price_cents, deposit_cents, currency, payment_status, source, answers
  ) values (
    p_org, v_svc.id, v_s.member_id, v_s.location_id, v_customer, v_s.starts_at, v_s.ends_at, v_s.blocked_until, v_s.id,
    v_status, v_svc.name, nullif(left(trim(p_notes), 2000), ''), v_svc.price_cents, v_svc.deposit_cents,
    v_org.currency, v_pay, 'online', v_answers
  ) returning * into v_booking;

  return jsonb_build_object(
    'id', v_booking.id,
    'manage_token', v_booking.manage_token,
    'status', v_booking.status,
    'member_id', v_booking.member_id,
    'session_id', v_s.id
  );
end;
$$;

revoke execute on function public.get_public_sessions(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.create_public_session_booking(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.get_public_sessions(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_public_session_booking(uuid, uuid, text, text, text, text, jsonb) to anon, authenticated;
