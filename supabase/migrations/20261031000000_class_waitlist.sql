-- Tempo — a waitlist for full class sessions (phase 3b part 2).
--
-- When a session is full, a customer can join its waitlist. When spots open up (someone cancels or is removed, someone
-- is moved to another session, or the team adds spots), the first people waiting whose group fits are booked in
-- automatically, in the order they joined. That happens in the database, in the same moment the spot is freed, so
-- nobody can take it in between. The people who were booked are then told by the app (the outbox is notified_at).
--
-- Not offered for a class that charges an online deposit: someone who hasn't paid can't be booked automatically.

create table public.class_waitlist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  spots int not null default 1 check (spots between 1 and 6),
  guest_names text,
  notes text,
  answers jsonb,
  -- waiting → booked (a spot opened and they were booked in), or left / removed / closed (the session was cancelled)
  status text not null default 'waiting' check (status in ('waiting', 'booked', 'left', 'removed', 'closed')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  booking_id uuid references public.bookings (id) on delete set null,
  promoted_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create unique index class_waitlist_one_per_person on public.class_waitlist (session_id, lower(email)) where status = 'waiting';
create index class_waitlist_session_idx on public.class_waitlist (session_id, status, created_at);
create index class_waitlist_outbox_idx on public.class_waitlist (promoted_at) where status = 'booked' and notified_at is null;

alter table public.class_waitlist enable row level security;
create policy "class waitlist: members read" on public.class_waitlist for select to authenticated
  using (private.is_org_member(org_id));
create policy "class waitlist: members update" on public.class_waitlist for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "class waitlist: admins delete" on public.class_waitlist for delete to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- ───────────────────────── Book people in when spots open ─────────────────────────
create function private.promote_class_waitlist(p_session uuid) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.class_sessions;
  v_svc public.services;
  v_org public.organizations;
  w public.class_waitlist;
  v_free int;
  v_cust uuid;
  v_status public.booking_status;
  v_id uuid;
  v_n int := 0;
begin
  select * into v_s from public.class_sessions where id = p_session for update;
  if v_s.id is null or v_s.status <> 'scheduled' or v_s.starts_at <= now() then
    return 0;
  end if;
  select * into v_svc from public.services where id = v_s.service_id;
  select * into v_org from public.organizations where id = v_s.org_id;
  -- someone who hasn't paid can't be booked automatically
  if v_svc.deposit_cents > 0 and v_org.stripe_charges_enabled then
    return 0;
  end if;
  v_status := case when v_svc.auto_approve then 'confirmed' else 'pending_approval' end;

  for w in select * from public.class_waitlist where session_id = p_session and status = 'waiting' order by created_at, id loop
    v_free := v_s.capacity - private.session_taken(p_session);
    exit when v_free <= 0;
    continue when w.spots > v_free; -- a bigger group waits; a smaller one behind it may use the spot

    if exists (
      select 1 from public.bookings b join public.customers c on c.id = b.customer_id
      where b.session_id = p_session and c.email = lower(w.email) and b.status in ('confirmed', 'pending_approval', 'pending_payment')
    ) then
      update public.class_waitlist set status = 'closed' where id = w.id; -- they booked another way
      continue;
    end if;

    insert into public.customers (org_id, name, email, phone)
    values (v_s.org_id, w.name, lower(w.email), w.phone)
    on conflict (org_id, email) do update set name = excluded.name, phone = coalesce(excluded.phone, public.customers.phone)
    returning id into v_cust;

    insert into public.bookings (
      org_id, service_id, member_id, location_id, customer_id, starts_at, ends_at, blocked_until, session_id,
      status, service_name, notes, price_cents, deposit_cents, currency, payment_status, source, answers, spots, guest_names
    ) values (
      v_s.org_id, v_svc.id, v_s.member_id, v_s.location_id, v_cust, v_s.starts_at, v_s.ends_at, v_s.blocked_until, v_s.id,
      v_status, v_svc.name, w.notes, v_svc.price_cents * w.spots, v_svc.deposit_cents * w.spots, v_org.currency, 'none', 'online',
      w.answers, w.spots, w.guest_names
    ) returning id into v_id;

    update public.class_waitlist set status = 'booked', booking_id = v_id, promoted_at = now(), customer_id = v_cust where id = w.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- A spot is freed: cancelled, moved to another session, or fewer spots held.
create function private.bookings_waitlist_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.session_id is not null and old.status in ('confirmed', 'pending_approval', 'pending_payment')
     and (new.status = 'cancelled' or new.session_id is distinct from old.session_id or new.spots < old.spots) then
    perform private.promote_class_waitlist(old.session_id);
  end if;
  return null;
end;
$$;
create trigger bookings_waitlist_after after update on public.bookings
  for each row when (old.session_id is not null) execute function private.bookings_waitlist_after();

-- More spots opened up, or the session was cancelled (everyone waiting is let go).
create function private.class_sessions_waitlist_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status = 'scheduled' then
    update public.class_waitlist set status = 'closed' where session_id = new.id and status = 'waiting';
  elsif new.status = 'scheduled' and new.capacity > old.capacity then
    perform private.promote_class_waitlist(new.id);
  end if;
  return null;
end;
$$;
create trigger class_sessions_waitlist_after after update on public.class_sessions
  for each row execute function private.class_sessions_waitlist_after();

-- ───────────────────────── Customers: the list shows who can join a waitlist ─────────────────────────
drop function public.get_public_sessions(uuid, timestamptz, timestamptz);
create function public.get_public_sessions(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(id uuid, service_id uuid, member_id uuid, location_id uuid, starts_at timestamptz, ends_at timestamptz, capacity int, booked int, notes text, waiting int, waitlist_open boolean)
language sql stable security definer set search_path = ''
as $$
  select cs.id, cs.service_id, cs.member_id, cs.location_id, cs.starts_at, cs.ends_at, cs.capacity,
         private.session_taken(cs.id), cs.notes,
         (select coalesce(sum(w.spots), 0)::int from public.class_waitlist w where w.session_id = cs.id and w.status = 'waiting'),
         (s.deposit_cents = 0 or not o.stripe_charges_enabled)
  from public.class_sessions cs
  join public.services s on s.id = cs.service_id and s.active and s.is_class
  join public.organizations o on o.id = cs.org_id
  where cs.org_id = p_org and cs.status = 'scheduled'
    and cs.starts_at > now()
    and cs.starts_at < p_to and cs.ends_at > p_from
    and p_to - p_from <= interval '120 days'
  order by cs.starts_at;
$$;
revoke execute on function public.get_public_sessions(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_public_sessions(uuid, timestamptz, timestamptz) to anon, authenticated;

-- ───────────────────────── Customers: join, see, leave ─────────────────────────
create function public.join_class_waitlist(
  p_org uuid,
  p_session uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_answers jsonb default null,
  p_spots int default 1,
  p_guests text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org public.organizations;
  v_s public.class_sessions;
  v_svc public.services;
  v_cust uuid;
  v_w public.class_waitlist;
  v_spots int := coalesce(p_spots, 1);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_answers jsonb;
begin
  if coalesce(trim(p_name), '') = '' or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Please enter your name and a valid email';
  end if;
  if v_spots < 1 or v_spots > 6 then
    raise exception 'You can ask for 1 to 6 spots at a time.';
  end if;

  select * into v_org from public.organizations where id = p_org;
  if v_org.id is null then
    raise exception 'Class not found';
  end if;
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
  if v_svc.deposit_cents > 0 and v_org.stripe_charges_enabled then
    raise exception 'There is no waitlist for this class.';
  end if;
  if v_s.capacity - private.session_taken(v_s.id) >= v_spots then
    raise exception 'There is room in this session now. Please book it instead.';
  end if;
  if exists (
    select 1 from public.bookings b join public.customers c on c.id = b.customer_id
    where b.session_id = v_s.id and c.email = v_email and b.status in ('confirmed', 'pending_approval', 'pending_payment')
  ) then
    raise exception 'You''re already booked into this class.';
  end if;
  if exists (select 1 from public.class_waitlist where session_id = v_s.id and lower(email) = v_email and status = 'waiting') then
    raise exception 'You''re already on the waitlist for this session.';
  end if;
  if (select count(*) from public.class_waitlist where session_id = v_s.id and status = 'waiting') >= 30 then
    raise exception 'The waitlist for this session is full.';
  end if;
  if (select count(*) from public.class_waitlist where org_id = p_org and lower(email) = v_email and status = 'waiting') >= 5 then
    raise exception 'You''re on several waitlists already. Leave one before joining another.';
  end if;

  v_answers := public.build_intake_answers(v_svc.id, p_answers);

  insert into public.customers (org_id, name, email, phone)
  values (p_org, left(trim(p_name), 120), v_email, nullif(left(trim(coalesce(p_phone, '')), 40), ''))
  on conflict (org_id, email) do update set name = excluded.name, phone = coalesce(excluded.phone, public.customers.phone)
  returning id into v_cust;

  insert into public.class_waitlist (org_id, session_id, customer_id, name, email, phone, spots, guest_names, notes, answers)
  values (p_org, v_s.id, v_cust, left(trim(p_name), 120), v_email, nullif(left(trim(coalesce(p_phone, '')), 40), ''), v_spots,
          case when v_spots > 1 then nullif(left(trim(coalesce(p_guests, '')), 300), '') else null end,
          nullif(left(trim(coalesce(p_notes, '')), 2000), ''), v_answers)
  returning * into v_w;

  return jsonb_build_object(
    'id', v_w.id,
    'token', v_w.token,
    'position', (select count(*) from public.class_waitlist x where x.session_id = v_s.id and x.status = 'waiting' and (x.created_at, x.id) <= (v_w.created_at, v_w.id))
  );
end;
$$;

create function public.get_waitlist_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'status', w.status,
    'spots', w.spots,
    'position', case when w.status = 'waiting'
      then (select count(*) from public.class_waitlist x where x.session_id = w.session_id and x.status = 'waiting' and (x.created_at, x.id) <= (w.created_at, w.id)) end,
    'starts_at', cs.starts_at, 'ends_at', cs.ends_at, 'session_status', cs.status,
    'service_name', s.name,
    'name', w.name,
    'booking_token', case when w.status = 'booked' then (select b.manage_token from public.bookings b where b.id = w.booking_id) end,
    'org', jsonb_build_object('name', o.name, 'slug', o.slug, 'timezone', o.timezone, 'accent_color', o.accent_color, 'phone', o.phone)
  )
  from public.class_waitlist w
  join public.class_sessions cs on cs.id = w.session_id
  join public.services s on s.id = cs.service_id
  join public.organizations o on o.id = w.org_id
  where w.token = p_token and length(p_token) >= 32;
$$;

create function public.leave_class_waitlist(p_token text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.class_waitlist set status = 'left' where token = p_token and length(p_token) >= 32 and status = 'waiting' returning id into v_id;
  if v_id is null then
    raise exception 'This waitlist spot is no longer active.';
  end if;
end;
$$;

revoke execute on function public.join_class_waitlist(uuid, uuid, text, text, text, text, jsonb, int, text) from public;
revoke execute on function public.get_waitlist_by_token(text) from public;
revoke execute on function public.leave_class_waitlist(text) from public;
grant execute on function public.join_class_waitlist(uuid, uuid, text, text, text, text, jsonb, int, text) to anon, authenticated;
grant execute on function public.get_waitlist_by_token(text) to anon, authenticated;
grant execute on function public.leave_class_waitlist(text) to anon, authenticated;
