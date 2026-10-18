-- Tempo — several spots in one class booking ("me and a friend"), phase 3b part 1.
--
-- A booking holds 1 to 6 spots. Capacity counts spots, not bookings. The booking's price and deposit are the totals
-- for all its spots, so revenue, exports and the deposit charge are right without any other change.
--   * bookings.spots, bookings.guest_names (optional names of the people who come with them)
--   * private.session_taken(): the spots in use
--   * the booking guard: capacity is checked in spots, also when spots are added to an existing booking
--   * create_public_session_booking(): takes p_spots and p_guests
--   * move_class_booking(): the target must have room for all of the person's spots
--   * {{spots}} in the built-in emails

alter table public.bookings
  add column spots int not null default 1 check (spots between 1 and 6),
  add column guest_names text;
comment on column public.bookings.spots is 'How many class spots this booking holds (price and deposit are totals for all of them).';

-- Spots in use: confirmed, awaiting approval, or a payment hold made in the last 30 minutes.
create or replace function private.session_taken(p_session uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(b.spots), 0)::int from public.bookings b
  where b.session_id = p_session
    and (b.status in ('confirmed', 'pending_approval')
         or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'));
$$;

-- ───────────────────────── The guards count spots ─────────────────────────
create or replace function private.bookings_class_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.class_sessions;
  v_others int;
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
    if new.status in ('confirmed', 'pending_approval', 'pending_payment')
       and (tg_op = 'INSERT' or old.status not in ('confirmed', 'pending_approval', 'pending_payment') or new.spots > old.spots) then
      if v_s.status <> 'scheduled' then
        raise exception 'This class has been cancelled.';
      end if;
      select coalesce(sum(b.spots), 0) into v_others from public.bookings b
      where b.session_id = new.session_id and b.id <> new.id
        and (b.status in ('confirmed', 'pending_approval')
             or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'));
      if v_others + new.spots > v_s.capacity then
        if v_s.capacity - v_others <= 0 then
          raise exception 'This class is full.';
        end if;
        raise exception 'Only % % left.', v_s.capacity - v_others, case when v_s.capacity - v_others = 1 then 'spot is' else 'spots are' end;
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

-- ───────────────────────── Book spots ─────────────────────────
drop function public.create_public_session_booking(uuid, uuid, text, text, text, text, jsonb);
create function public.create_public_session_booking(
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
  v_customer uuid;
  v_booking public.bookings;
  v_status public.booking_status;
  v_pay public.payment_status;
  v_answers jsonb;
  v_spots int := coalesce(p_spots, 1);
  v_left int;
begin
  if coalesce(trim(p_name), '') = '' or trim(coalesce(p_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(trim(p_email)) > 254 then
    raise exception 'Please enter your name and a valid email';
  end if;
  if v_spots < 1 or v_spots > 6 then
    raise exception 'You can book 1 to 6 spots at a time.';
  end if;

  select * into v_org from public.organizations where id = p_org;
  if v_org.id is null then
    raise exception 'Class not found';
  end if;

  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed'
  where org_id = p_org and status = 'pending_payment' and created_at < now() - interval '30 minutes';

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
  v_left := v_s.capacity - private.session_taken(v_s.id);
  if v_left <= 0 then
    raise exception 'Sorry, this class is full.';
  end if;
  if v_spots > v_left then
    raise exception 'Only % % left.', v_left, case when v_left = 1 then 'spot is' else 'spots are' end;
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
    status, service_name, notes, price_cents, deposit_cents, currency, payment_status, source, answers, spots, guest_names
  ) values (
    p_org, v_svc.id, v_s.member_id, v_s.location_id, v_customer, v_s.starts_at, v_s.ends_at, v_s.blocked_until, v_s.id,
    v_status, v_svc.name, nullif(left(trim(p_notes), 2000), ''), v_svc.price_cents * v_spots, v_svc.deposit_cents * v_spots,
    v_org.currency, v_pay, 'online', v_answers, v_spots, case when v_spots > 1 then nullif(left(trim(coalesce(p_guests, '')), 300), '') else null end
  ) returning * into v_booking;

  return jsonb_build_object(
    'id', v_booking.id,
    'manage_token', v_booking.manage_token,
    'status', v_booking.status,
    'member_id', v_booking.member_id,
    'session_id', v_s.id,
    'spots', v_booking.spots
  );
end;
$$;
revoke execute on function public.create_public_session_booking(uuid, uuid, text, text, text, text, jsonb, int, text) from public;
grant execute on function public.create_public_session_booking(uuid, uuid, text, text, text, text, jsonb, int, text) to anon, authenticated;

-- ───────────────────────── Moving someone needs room for all their spots ─────────────────────────
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.move_class_booking(uuid,uuid)'::regprocedure);
  patched := replace(def, $q$  if private.session_taken(v_to.id) >= v_to.capacity then
    raise exception 'That session is full.';
  end if;$q$, $q$  if private.session_taken(v_to.id) + v_b.spots > v_to.capacity then
    raise exception 'That session is full.';
  end if;$q$);
  if patched = def then raise exception 'move_class_booking was not patched'; end if;
  execute patched;

  -- the manage page needs the number of spots
  def := pg_get_functiondef('public.get_booking_by_token(text)'::regprocedure);
  patched := replace(def, $q$'session_id', b.session_id,$q$, $q$'session_id', b.session_id, 'spots', b.spots, 'guest_names', b.guest_names,$q$);
  if patched = def then raise exception 'get_booking_by_token was not patched'; end if;
  execute patched;
end $$;

-- ───────────────────────── The built-in emails mention the spots ─────────────────────────
-- {{spots}} reads "2 spots" for a booking with several and disappears for one. It is added under the deposit line
-- of the built-in messages wherever they still have their original layout.
update public.workflow_steps s
set body = replace(s.body, E'Deposit: {{deposit}}', E'Deposit: {{deposit}}\nSpots: {{spots}}')
from public.workflows w
where s.workflow_id = w.id and w.default_key is not null and s.body like '%Deposit: {{deposit}}%' and s.body not like '%{{spots}}%';
