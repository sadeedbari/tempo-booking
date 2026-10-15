-- Tempo — website contact form ("inquiries").
--
-- A visitor to a business's website (or hosted contact page) asks a question before booking: name, email,
-- optional phone, the service they are interested in, and a message. Each submission
--   * creates the customer (or fills blanks on the existing one, matched by email),
--   * is stored as an inquiry the team works through (new → handled → archived),
--   * is announced to the team by email and push (done by the app after this function returns).
--
-- Visitors can only submit, through create_public_inquiry(); they can never read anything.

alter table public.organizations
  add column inquiries_enabled boolean not null default true,
  add column inquiry_notify_email text check (inquiry_notify_email is null or char_length(inquiry_notify_email) <= 254);
comment on column public.organizations.inquiries_enabled is 'Whether the website contact form accepts messages.';
comment on column public.organizations.inquiry_notify_email is 'Optional single address for new-inquiry emails. When empty, every owner and admin is emailed.';

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  service_id uuid references public.services (id) on delete set null,
  -- the service name as it was when the question was asked
  service_name text not null default '',
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) <= 40),
  message text not null check (char_length(message) between 2 and 2000),
  status text not null default 'new' check (status in ('new', 'handled', 'archived')),
  -- private note for the team
  note text check (note is null or char_length(note) <= 2000),
  -- one-way hash of the sender's network address, only used to slow down spam
  ip_hash text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users (id) on delete set null
);
create index inquiries_org_status_idx on public.inquiries (org_id, status, created_at desc);
create index inquiries_org_email_idx on public.inquiries (org_id, lower(email), created_at desc);
create index inquiries_org_ip_idx on public.inquiries (org_id, ip_hash, created_at desc) where ip_hash is not null;
create index inquiries_customer_idx on public.inquiries (customer_id) where customer_id is not null;

alter table public.inquiries enable row level security;

-- Any team member can read and work through inquiries; only owners and admins can delete them.
-- There is no insert policy: the public form goes through create_public_inquiry() below.
create policy "inquiries: members read" on public.inquiries for select to authenticated
  using (private.is_org_member(org_id));
create policy "inquiries: members update" on public.inquiries for update to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy "inquiries: admins delete" on public.inquiries for delete to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- Staff may only change the status and the note, never the visitor's words.
create or replace function public.inquiries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if new.org_id is distinct from old.org_id or new.name is distinct from old.name or new.email is distinct from old.email
       or new.phone is distinct from old.phone or new.message is distinct from old.message
       or new.service_id is distinct from old.service_id or new.service_name is distinct from old.service_name
       or new.created_at is distinct from old.created_at or new.ip_hash is distinct from old.ip_hash then
      raise exception 'Only the status and note of an inquiry can be changed';
    end if;
    if new.status is distinct from old.status then
      new.handled_at := case when new.status = 'new' then null else coalesce(old.handled_at, now()) end;
      new.handled_by := case when new.status = 'new' then null else (select auth.uid()) end;
    end if;
  end if;
  return new;
end $$;
create trigger inquiries_guard before update on public.inquiries
  for each row execute function public.inquiries_guard();

-- ───────────────────────── Public: what the form needs ─────────────────────────
create or replace function public.get_public_contact(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org', jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'description', o.description,
      'accent_color', o.accent_color, 'logo_url', o.logo_url, 'phone', o.phone,
      'currency', o.currency, 'inquiries_enabled', o.inquiries_enabled
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug) order by s.position, s.created_at)
      from public.services s where s.org_id = o.id and s.active
    ), '[]'::jsonb)
  )
  from public.organizations o where o.slug = p_slug;
$$;

-- ───────────────────────── Public: send an inquiry ─────────────────────────
create or replace function public.create_public_inquiry(
  p_org uuid,
  p_service uuid,       -- null = "not sure yet"
  p_name text,
  p_email text,
  p_phone text,
  p_message text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_name text := left(trim(coalesce(p_name, '')), 120);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_message text := left(trim(coalesce(p_message, '')), 2000);
  v_service_id uuid;
  v_service_name text := '';
  v_customer uuid;
  v_existing uuid;
  v_id uuid;
begin
  select * into v_org from public.organizations where id = p_org;
  if v_org.id is null or not v_org.inquiries_enabled then
    raise exception 'This business is not taking messages through its website right now.';
  end if;

  if v_name = '' then raise exception 'Please enter your name.'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Please enter a valid email address.';
  end if;
  if char_length(v_message) < 2 then raise exception 'Please write a short message.'; end if;

  -- The same message sent twice (a double click, a retry) is stored once.
  select id into v_existing from public.inquiries
    where org_id = p_org and lower(email) = v_email and message = v_message and created_at > now() - interval '10 minutes'
    limit 1;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'duplicate', true);
  end if;

  -- Slow down spam: per address, per network, and per business.
  if (select count(*) from public.inquiries where org_id = p_org and lower(email) = v_email and created_at > now() - interval '1 hour') >= 3
     or (p_ip_hash is not null and (select count(*) from public.inquiries where org_id = p_org and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10)
     or (select count(*) from public.inquiries where org_id = p_org and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many messages were sent just now. Please try again in a little while.';
  end if;

  if p_service is not null then
    select s.id, s.name into v_service_id, v_service_name
      from public.services s where s.id = p_service and s.org_id = p_org and s.active;
    v_service_name := coalesce(v_service_name, '');
  end if;

  -- The customer: matched by email. An existing customer keeps their name; a missing phone is filled in.
  insert into public.customers (org_id, name, email, phone)
    values (p_org, v_name, v_email, v_phone)
    on conflict (org_id, email) do update set phone = coalesce(public.customers.phone, excluded.phone)
    returning id into v_customer;

  insert into public.inquiries (org_id, customer_id, service_id, service_name, name, email, phone, message, ip_hash)
    values (p_org, v_customer, v_service_id, v_service_name, v_name, v_email, v_phone, v_message, p_ip_hash)
    returning id into v_id;

  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

revoke execute on function public.get_public_contact(text) from public;
revoke execute on function public.create_public_inquiry(uuid, uuid, text, text, text, text, text) from public;
grant execute on function public.get_public_contact(text) to anon, authenticated;
grant execute on function public.create_public_inquiry(uuid, uuid, text, text, text, text, text) to anon, authenticated;
