-- Tempo — a schedule per location, and scheduling one person at two locations at the same time.
--
-- 1. The "no overlapping shifts" rule used to apply across all of a person's shifts. It now only applies within the
--    same location, so an admin can deliberately schedule someone at two places at once (the app warns, but allows it).
--    A person still can't be booked twice at the same time: bookings have their own overlap protection.
-- 2. Copy previous week/month and Fill from weekly hours can work on one location only.

alter table public.shifts drop constraint shifts_no_overlap;
alter table public.shifts add constraint shifts_no_overlap_same_location exclude using gist (
  member_id with =,
  (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
  tsrange(day + start_time, day + end_time) with &&
);

-- p_location null = all locations (as before). p_location set = only that location's shifts are copied and replaced.
drop function public.copy_shifts(uuid, jsonb, boolean);
create or replace function public.copy_shifts(p_org uuid, p_pairs jsonb, p_replace boolean, p_location uuid default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  v_from date;
  v_to date;
  v_n int := 0;
  v_c int;
begin
  if jsonb_array_length(p_pairs) > 62 then
    raise exception 'Too many days to copy at once';
  end if;
  for r in select * from jsonb_array_elements(p_pairs) loop
    v_from := (r->>'from')::date;
    v_to := (r->>'to')::date;
    if p_replace then
      delete from public.shifts
      where org_id = p_org and day = v_to and (p_location is null or location_id = p_location);
    end if;
    insert into public.shifts (org_id, member_id, location_id, day, start_time, end_time)
    select s.org_id, s.member_id, s.location_id, v_to, s.start_time, s.end_time
    from public.shifts s
    where s.org_id = p_org and s.day = v_from
      and (p_location is null or s.location_id = p_location)
      and (p_replace or not exists (
        select 1 from public.shifts t
        where t.org_id = p_org and t.member_id = s.member_id and t.day = v_to
          and (p_location is null or t.location_id = p_location)
      ));
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;
  return v_n;
end;
$$;

-- p_location set: shifts are created at that location, for people who work there (or everyone if nobody is assigned
-- to it), on days they have no shift at that location yet.
drop function public.fill_shifts_from_weekly(uuid, date, date);
create or replace function public.fill_shifts_from_weekly(p_org uuid, p_from date, p_to date, p_location uuid default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'Pick a range of up to two months';
  end if;
  insert into public.shifts (org_id, member_id, location_id, day, start_time, end_time)
  select p_org, r.member_id, p_location, d::date, r.start_time, r.end_time
  from generate_series(p_from, p_to, interval '1 day') d
  join public.availability_rules r on r.org_id = p_org and r.weekday = extract(dow from d)::int
  join public.memberships m on m.id = r.member_id and m.bookable
  where (
      p_location is null
      or not exists (select 1 from public.member_locations ml where ml.location_id = p_location)
      or exists (select 1 from public.member_locations ml where ml.location_id = p_location and ml.member_id = r.member_id)
    )
    and not exists (
      select 1 from public.shifts s
      where s.member_id = r.member_id and s.day = d::date
        and (p_location is null or s.location_id = p_location)
    );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.copy_shifts(uuid, jsonb, boolean, uuid) from public, anon;
revoke execute on function public.fill_shifts_from_weekly(uuid, date, date, uuid) from public, anon;
grant execute on function public.copy_shifts(uuid, jsonb, boolean, uuid) to authenticated;
grant execute on function public.fill_shifts_from_weekly(uuid, date, date, uuid) to authenticated;
