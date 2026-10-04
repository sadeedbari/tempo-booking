-- Tempo — initial schema
-- Teams (organizations), members with roles, services, availability,
-- customers, bookings, invitations, reminders. Row Level Security everywhere.

create extension if not exists btree_gist with schema extensions;

-- ───────────────────────────── Types ─────────────────────────────
create type public.org_role as enum ('owner', 'admin', 'member');
create type public.service_kind as enum ('appointment', 'meeting');
create type public.location_type as enum ('in_person', 'video', 'phone');
create type public.booking_status as enum ('pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show');
create type public.payment_status as enum ('none', 'pending', 'paid', 'refunded');

-- ───────────────────────────── Profiles ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── Organizations ─────────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  description text,
  timezone text not null default 'America/Toronto',
  currency text not null default 'CAD',
  accent_color text not null default '#007AFF',
  logo_url text,
  address text,
  phone text,
  website text,
  -- booking rules
  min_notice_minutes int not null default 60 check (min_notice_minutes >= 0),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  slot_interval_minutes int not null default 15 check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  cancellation_window_hours int not null default 24 check (cancellation_window_hours >= 0),
  reminder_hours_before int not null default 24 check (reminder_hours_before between 0 and 168),
  -- payments
  stripe_account_id text,
  stripe_charges_enabled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── Memberships ─────────────────────────────
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  display_name text not null default '',
  title text,
  color text not null default '#007AFF',
  bookable boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Helper functions (security definer so policies don't recurse)
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

create or replace function public.member_org(p_member uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.memberships where id = p_member;
$$;

create or replace function public.is_self_member(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.memberships where id = p_member and user_id = (select auth.uid()));
$$;

-- ───────────────────────────── Invitations ─────────────────────────────
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.org_role not null default 'member' check (role <> 'owner'),
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (org_id);

-- ───────────────────────────── Services ─────────────────────────────
create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9-]{1,60}$'),
  description text,
  kind public.service_kind not null default 'appointment',
  duration_minutes int not null default 30 check (duration_minutes between 5 and 720),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes between 0 and 240),
  price_cents int not null default 0 check (price_cents >= 0),
  deposit_cents int not null default 0 check (deposit_cents >= 0),
  color text not null default '#007AFF',
  location_type public.location_type not null default 'in_person',
  location_detail text,
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, slug),
  check (deposit_cents <= price_cents or price_cents = 0)
);
create index services_org_idx on public.services (org_id);

create table public.service_staff (
  service_id uuid not null references public.services (id) on delete cascade,
  member_id uuid not null references public.memberships (id) on delete cascade,
  primary key (service_id, member_id)
);
create index service_staff_member_idx on public.service_staff (member_id);

-- ───────────────────────────── Availability ─────────────────────────────
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null references public.memberships (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index availability_rules_member_idx on public.availability_rules (member_id);
create index availability_rules_org_idx on public.availability_rules (org_id);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null references public.memberships (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);
create index time_off_member_idx on public.time_off (member_id, starts_at);
create index time_off_org_idx on public.time_off (org_id);

-- ───────────────────────────── Customers ─────────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

-- ───────────────────────────── Bookings ─────────────────────────────
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  member_id uuid not null references public.memberships (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- includes buffer time; used for conflict detection
  blocked_until timestamptz not null,
  status public.booking_status not null default 'confirmed',
  service_name text not null default '',
  notes text,
  price_cents int not null default 0,
  deposit_cents int not null default 0,
  currency text not null default 'CAD',
  payment_status public.payment_status not null default 'none',
  stripe_checkout_session_id text,
  manage_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  source text not null default 'online' check (source in ('online', 'manual')),
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (blocked_until >= ends_at),
  -- no double-booking of the same staff member
  constraint bookings_no_overlap exclude using gist (
    member_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status in ('pending_payment', 'confirmed'))
);
create index bookings_org_time_idx on public.bookings (org_id, starts_at);
create index bookings_member_time_idx on public.bookings (member_id, starts_at);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_service_idx on public.bookings (service_id);
create index bookings_reminder_idx on public.bookings (starts_at) where reminder_sent_at is null and status = 'confirmed';

-- ───────────────────────────── RPCs ─────────────────────────────
-- Create a team and make the caller its owner, with default weekday hours.
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_member uuid;
  v_uid uuid := (select auth.uid());
  d int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.organizations (name, slug, timezone, created_by)
  values (p_name, lower(p_slug), coalesce(nullif(p_timezone, ''), 'America/Toronto'), v_uid)
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, v_uid, 'owner', coalesce(nullif(p_display_name, ''), 'Owner'))
  returning id into v_member;

  for d in 1..5 loop
    insert into public.availability_rules (org_id, member_id, weekday, start_time, end_time)
    values (v_org, v_member, d, '09:00', '17:00');
  end loop;

  return v_org;
end;
$$;

-- Accept an invitation addressed to the caller's email.
create or replace function public.accept_invitation(p_token text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_uid uuid := (select auth.uid());
  v_email text;
  v_member uuid;
  d int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_inv from public.invitations
  where token = p_token and accepted_at is null and expires_at > now();

  if v_inv.id is null then
    raise exception 'Invitation is invalid or has expired';
  end if;

  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invitation was sent to a different email address';
  end if;

  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_inv.org_id, v_uid, v_inv.role, coalesce(nullif(p_display_name, ''), split_part(v_email, '@', 1)))
  on conflict (org_id, user_id) do nothing
  returning id into v_member;

  if v_member is not null then
    for d in 1..5 loop
      insert into public.availability_rules (org_id, member_id, weekday, start_time, end_time)
      values (v_inv.org_id, v_member, d, '09:00', '17:00');
    end loop;
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

-- Prevent removing/demoting the last owner.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if (select count(*) from public.memberships where org_id = old.org_id and role = 'owner') <= 1
       and exists (select 1 from public.organizations where id = old.org_id) then
      raise exception 'A team must keep at least one owner';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger memberships_protect_owner
  before update or delete on public.memberships
  for each row execute function public.protect_last_owner();

-- Only owners may grant the owner role.
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
    if (select auth.uid()) is not null and not public.has_org_role(new.org_id, array['owner']::public.org_role[])
       and (new.role = 'owner' or old.role = 'owner') then
      raise exception 'Only owners can change owner roles';
    end if;
    if (select auth.uid()) is not null and not public.has_org_role(new.org_id, array['owner','admin']::public.org_role[]) then
      raise exception 'Not allowed to change roles';
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_guard_role
  before update on public.memberships
  for each row execute function public.guard_role_change();

-- ───────────────────────────── Row Level Security ─────────────────────────────
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.services enable row level security;
alter table public.service_staff enable row level security;
alter table public.availability_rules enable row level security;
alter table public.time_off enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;

-- profiles
create policy "profiles: read self and teammates" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships a
      join public.memberships b on a.org_id = b.org_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy "profiles: update self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organizations
create policy "orgs: members read" on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy "orgs: admins update" on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner','admin']::public.org_role[]));
create policy "orgs: owners delete" on public.organizations for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.org_role[]));

-- memberships
create policy "members: read teammates" on public.memberships for select to authenticated
  using (public.is_org_member(org_id));
create policy "members: admins or self update" on public.memberships for update to authenticated
  using (user_id = (select auth.uid()) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (user_id = (select auth.uid()) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "members: admins remove or self leave" on public.memberships for delete to authenticated
  using (user_id = (select auth.uid()) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- invitations
create policy "invites: admins read" on public.invitations for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "invites: admins create" on public.invitations for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "invites: admins delete" on public.invitations for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- services
create policy "services: members read" on public.services for select to authenticated
  using (public.is_org_member(org_id));
create policy "services: admins insert" on public.services for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "services: admins update" on public.services for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "services: admins delete" on public.services for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- service_staff
create policy "service_staff: members read" on public.service_staff for select to authenticated
  using (public.is_org_member(public.member_org(member_id)));
create policy "service_staff: admins insert" on public.service_staff for insert to authenticated
  with check (
    public.has_org_role(public.member_org(member_id), array['owner','admin']::public.org_role[])
    and exists (select 1 from public.services s where s.id = service_id and s.org_id = public.member_org(member_id))
  );
create policy "service_staff: admins delete" on public.service_staff for delete to authenticated
  using (public.has_org_role(public.member_org(member_id), array['owner','admin']::public.org_role[]));

-- availability_rules: admins, or staff managing their own hours
create policy "availability: members read" on public.availability_rules for select to authenticated
  using (public.is_org_member(org_id));
create policy "availability: admins or self insert" on public.availability_rules for insert to authenticated
  with check (public.member_org(member_id) = org_id and (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[])));
create policy "availability: admins or self update" on public.availability_rules for update to authenticated
  using (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.member_org(member_id) = org_id and (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[])));
create policy "availability: admins or self delete" on public.availability_rules for delete to authenticated
  using (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- time_off
create policy "time_off: members read" on public.time_off for select to authenticated
  using (public.is_org_member(org_id));
create policy "time_off: admins or self insert" on public.time_off for insert to authenticated
  with check (public.member_org(member_id) = org_id and (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[])));
create policy "time_off: admins or self update" on public.time_off for update to authenticated
  using (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.member_org(member_id) = org_id and (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[])));
create policy "time_off: admins or self delete" on public.time_off for delete to authenticated
  using (public.is_self_member(member_id) or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- customers: any team member can manage
create policy "customers: members read" on public.customers for select to authenticated
  using (public.is_org_member(org_id));
create policy "customers: members insert" on public.customers for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "customers: members update" on public.customers for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "customers: admins delete" on public.customers for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- bookings: any team member can manage
create policy "bookings: members read" on public.bookings for select to authenticated
  using (public.is_org_member(org_id));
create policy "bookings: members insert" on public.bookings for insert to authenticated
  with check (public.is_org_member(org_id) and public.member_org(member_id) = org_id);
create policy "bookings: members update" on public.bookings for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.member_org(member_id) = org_id);
create policy "bookings: admins delete" on public.bookings for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- Lock down the helper/RPC functions
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_last_owner() from public, anon, authenticated;
revoke execute on function public.guard_role_change() from public, anon, authenticated;
revoke execute on function public.create_organization(text, text, text, text) from public, anon;
revoke execute on function public.accept_invitation(text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.accept_invitation(text, text) to authenticated;
