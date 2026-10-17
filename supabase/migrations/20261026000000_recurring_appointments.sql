-- Tempo — recurring appointments.
--
-- A series is a group of ordinary bookings that share a series id (booking_series), one per date. Everything that
-- works for a booking (reminders, changing one date, cancelling, calendar sync) keeps working per date.
--   * services.allow_series: the business lets customers book a repeating appointment online.
--   * create_public_booking_series(): books every date through create_public_booking(), so every rule that applies to a
--     single booking applies to each date (hours, time off, other bookings, notice, intake answers). Dates that don't
--     fit are skipped and reported. With p_dry_run it reports what would happen and books nothing.
--   * get_series_by_token / cancel_series_following_by_token: the customer's manage page.

alter table public.services add column allow_series boolean not null default false;
comment on column public.services.allow_series is 'Customers may book this service as a repeating series online (needs automatic approval and no online deposit).';

create table public.booking_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  service_id uuid references public.services (id) on delete set null,
  member_id uuid references public.memberships (id) on delete set null,
  location_id uuid references public.locations (id) on delete set null,
  -- every N weeks
  interval_weeks int not null check (interval_weeks between 1 and 4),
  count_requested int not null check (count_requested between 2 and 52),
  first_starts_at timestamptz not null,
  source text not null default 'online' check (source in ('online', 'manual')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index booking_series_org_idx on public.booking_series (org_id, created_at desc);

alter table public.bookings
  add column series_id uuid references public.booking_series (id) on delete set null,
  add column series_index int;
create index bookings_series_idx on public.bookings (series_id, starts_at) where series_id is not null;

alter table public.booking_series enable row level security;
create policy "booking series: members read" on public.booking_series for select to authenticated
  using (private.is_org_member(org_id));
create policy "booking series: members insert" on public.booking_series for insert to authenticated
  with check (private.is_org_member(org_id));
create policy "booking series: members update" on public.booking_series for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "booking series: admins delete" on public.booking_series for delete to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- ───────────────────────── The booking form's data ─────────────────────────
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.get_public_org(text)'::regprocedure);
  patched := replace(def, $q$'auto_approve', s.auto_approve,$q$, $q$'auto_approve', s.auto_approve, 'allow_series', s.allow_series,$q$);
  if patched = def then raise exception 'get_public_org was not patched'; end if;
  execute patched;
end $$;

-- ───────────────────────── Book a series ─────────────────────────
create or replace function public.create_public_booking_series(
  p_org uuid,
  p_service uuid,
  p_member uuid,
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_location uuid default null,
  p_address text default null,
  p_answers jsonb default null,
  p_interval_weeks int default 1,
  p_count int default 2,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_svc public.services;
  v_series uuid;
  v_when timestamptz;
  v_res jsonb;
  v_booked jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_customer uuid;
  i int;
begin
  select * into v_org from public.organizations where id = p_org;
  select * into v_svc from public.services where id = p_service and org_id = p_org and active;
  if v_org.id is null or v_svc.id is null then
    raise exception 'Service not found';
  end if;
  if not v_svc.allow_series or not v_svc.auto_approve or (v_svc.deposit_cents > 0 and v_org.stripe_charges_enabled) then
    raise exception 'This service can''t be booked as a repeating series.';
  end if;
  if p_interval_weeks is null or p_interval_weeks not between 1 and 4 or p_count is null or p_count not between 2 and 26 then
    raise exception 'Please choose how often it repeats and how many times (2 to 26).';
  end if;

  insert into public.booking_series (org_id, service_id, member_id, location_id, interval_weeks, count_requested, first_starts_at, source)
    values (p_org, p_service, p_member, p_location, p_interval_weeks, p_count, p_starts_at, 'online')
    returning id into v_series;

  -- A preview is only about which dates are free: it must not stumble over questions the customer hasn't answered yet.
  if p_dry_run then perform set_config('tempo.preview', '1', true); end if;

  for i in 0 .. p_count - 1 loop
    -- the same time of day each time, even across a clock change
    v_when := ((p_starts_at at time zone v_org.timezone) + make_interval(weeks => i * p_interval_weeks)) at time zone v_org.timezone;
    begin
      v_res := public.create_public_booking(p_org, p_service, p_member, v_when, p_name, p_email, p_phone, p_notes, p_location, p_address, p_answers);
      update public.bookings set series_id = v_series, series_index = i where id = (v_res ->> 'id')::uuid;
      v_booked := v_booked || jsonb_build_array(v_res || jsonb_build_object('index', i, 'starts_at', v_when));
    exception when others then
      -- the time the customer picked first has to work; later dates that don't fit are skipped and reported
      if i = 0 then raise; end if;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('index', i, 'starts_at', v_when, 'reason', sqlerrm));
    end;
  end loop;

  select customer_id into v_customer from public.bookings where id = (v_booked -> 0 ->> 'id')::uuid;
  update public.booking_series set customer_id = v_customer where id = v_series;

  v_res := jsonb_build_object('series_id', v_series, 'booked', v_booked, 'skipped', v_skipped);
  if p_dry_run then
    -- roll everything back and hand the result out through the error
    raise exception using errcode = 'P0002', message = v_res::text;
  end if;
  return v_res;
exception when sqlstate 'P0002' then
  return sqlerrm::jsonb;
end $$;

revoke execute on function public.create_public_booking_series(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, int, int, boolean) from public;
grant execute on function public.create_public_booking_series(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, int, int, boolean) to anon, authenticated;

-- In a preview, required booking questions aren't enforced (the answers aren't known yet). The setting only exists
-- inside the preview's own transaction, which is always rolled back.
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.build_intake_answers(uuid,jsonb,boolean)'::regprocedure);
  patched := replace(def, 'if q.required and p_enforce then', E'if q.required and p_enforce and coalesce(current_setting(''tempo.preview'', true), '''') <> ''1'' then');
  if patched = def then raise exception 'build_intake_answers was not patched'; end if;
  execute patched;
end $$;

-- ───────────────────────── The customer's manage page ─────────────────────────
create or replace function public.get_series_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_s public.booking_series;
  v_items jsonb;
  v_index int;
begin
  select * into v_b from public.bookings where manage_token = p_token and length(p_token) >= 32;
  if v_b.id is null or v_b.series_id is null then return null; end if;
  select * into v_s from public.booking_series where id = v_b.series_id;
  select jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'status', b.status, 'current', b.id = v_b.id) order by b.starts_at)
    into v_items from public.bookings b where b.series_id = v_b.series_id;
  select count(*) into v_index from public.bookings b where b.series_id = v_b.series_id and b.starts_at <= v_b.starts_at;
  return jsonb_build_object('interval_weeks', v_s.interval_weeks, 'index', v_index, 'total', jsonb_array_length(v_items), 'items', v_items);
end $$;

create or replace function public.cancel_series_following_by_token(p_token text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_window int;
  v_ids uuid[];
begin
  select * into v_b from public.bookings where manage_token = p_token and length(p_token) >= 32;
  if v_b.id is null then raise exception 'Booking not found'; end if;
  if v_b.series_id is null then raise exception 'This booking is not part of a repeating series'; end if;
  if v_b.status not in ('confirmed', 'pending_payment', 'pending_approval') then
    raise exception 'This booking can no longer be cancelled';
  end if;
  select cancellation_window_hours into v_window from public.organizations where id = v_b.org_id;
  if v_b.status <> 'pending_approval' and v_b.starts_at < now() + make_interval(hours => v_window) then
    raise exception 'Online cancellation has closed for this booking. Please contact the business.';
  end if;
  with c as (
    update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(trim(p_reason), '')
    where series_id = v_b.series_id and starts_at >= v_b.starts_at and status in ('confirmed', 'pending_payment', 'pending_approval')
    returning id
  )
  select array_agg(id) into v_ids from c;
  return jsonb_build_object('cancelled', coalesce(array_length(v_ids, 1), 0), 'ids', coalesce(to_jsonb(v_ids), '[]'::jsonb), 'first', v_b.id);
end $$;

revoke execute on function public.get_series_by_token(text) from public;
revoke execute on function public.cancel_series_following_by_token(text, text) from public;
grant execute on function public.get_series_by_token(text) to anon, authenticated;
grant execute on function public.cancel_series_following_by_token(text, text) to anon, authenticated;

-- ───────────────────────── The built-in confirmation mentions the series ─────────────────────────
-- {{series}} lists every date for a repeating appointment and disappears for a single booking. It is added to the
-- built-in confirmation email wherever that email still has its original layout.
update public.workflow_steps s
set body = replace(s.body, E'Deposit: {{deposit}}\n\n{{manage_button}}', E'Deposit: {{deposit}}\n\n{{series}}\n\n{{manage_button}}')
from public.workflows w
where s.workflow_id = w.id and w.default_key = 'confirmed' and s.channel = 'email' and s.body not like '%{{series}}%';
