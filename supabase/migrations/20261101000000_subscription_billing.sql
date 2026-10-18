-- Tempo — subscription billing.
--
-- Every business (organization) has one row in public.subscriptions: a 14-day free trial that needs no card,
-- then a paid plan. Stripe is the source of truth for billing; this row is a local copy that is only ever written
-- by the server with the service-role key (the Stripe webhook, the cron job and the billing server actions).
-- Clients can read their own row (owners only) but can never change it.
--
-- The database itself enforces the plan:
--   * locations and team members cannot be added beyond what the plan includes (triggers, serialised per business),
--   * when the business has no active plan (trial over, cancelled, unpaid) nothing new can be booked by anyone
--     (public page, embed, API, dashboard, waitlist), and the dashboard cannot create or change anything
--     (restrictive row-level-security policies). Reading and exporting data keep working. Nothing is deleted.
--
-- Pricing (in the app, not here): $15/mo = 1 location + 5 staff; +$15/mo per extra location (+5 staff);
-- +$5/mo per staff pack (+5 staff, shared by the whole business).
--   max locations = 1 + extra_locations
--   max staff     = max locations * 5 + staff_packs * 5        (trial: 1 location, 5 staff)

-- ───────────────────────────── Tables ─────────────────────────────
create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- trial → active → (past_due → expired) | cancelled. "expired" = trial ended / unpaid past the grace period.
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at timestamptz not null,
  current_period_end timestamptz,
  extra_locations int not null default 0 check (extra_locations between 0 and 100),
  staff_packs int not null default 0 check (staff_packs between 0 and 200),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  -- the owner cancelled: access continues until current_period_end
  cancel_at_period_end boolean not null default false,
  -- when the first failed payment of the current problem happened; the 7-day grace period counts from here
  past_due_since timestamptz,
  -- newest Stripe event applied, so an old event delivered late can't undo a newer one
  last_stripe_event_at timestamptz,
  trial_reminder_sent_at timestamptz,
  trial_ended_email_sent_at timestamptz,
  -- the hourly job re-reads a few subscriptions from Stripe each run, least recently checked first. This is stamped on
  -- EVERY attempt (even when Stripe has no such subscription), so rows that never change can't hog the queue.
  last_reconciled_at timestamptz,
  -- set when Stripe answered "no such subscription" for stripe_subscription_id (cleared when it is found again)
  stripe_missing_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_reconcile_idx on public.subscriptions (last_reconciled_at nulls first) where stripe_subscription_id is not null;

alter table public.subscriptions enable row level security;
-- Owners may read their business's subscription. Nobody can write through the API: no insert/update/delete policy
-- exists, and the grants are removed as well. The service role (webhooks, cron, server actions) bypasses RLS.
create policy "subscriptions: owners read" on public.subscriptions for select to authenticated
  using (private.has_org_role(org_id, array['owner']::public.org_role[]));
revoke all on public.subscriptions from anon;
revoke insert, update, delete, truncate on public.subscriptions from authenticated;

-- Stripe events already handled (the webhook is idempotent: a replayed event id is ignored).
create table public.stripe_billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.stripe_billing_events enable row level security;
revoke all on public.stripe_billing_events from anon, authenticated;

-- ───────────────────────────── Trial for every business ─────────────────────────────
-- Existing businesses get a fresh 14 days from the moment this migration runs.
insert into public.subscriptions (org_id, status, trial_ends_at)
select id, 'trial', now() + interval '14 days' from public.organizations
on conflict (org_id) do nothing;

-- ───────────────────────────── One free trial per person, and a cap on teams ─────────────────────────────
-- A durable record of who has had a free trial. It holds NO personal data: only keyed hashes (HMAC-SHA256) and a date.
--   * one hash of the normalised, verified email address, and
--   * one hash of the user id (so changing the verified email on the same account cannot earn a second trial).
-- The key is a server-side secret (the TRIAL_CLAIM_SECRET environment variable). It is never stored in the database or
-- in any file: the app passes it to create_organization_as() on every call, and without it nothing can be claimed
-- (team creation fails closed). Without the key the hashes cannot be reversed or even tested against a guessed address.
-- There are no foreign keys: deleting a business or an account never removes a record, so deleting and recreating a
-- business can't buy another trial. Only the server (service role) and the functions below touch the table.
-- Retention: records are kept indefinitely, because preventing repeat free trials is their only purpose; since only
-- hashes remain, no person can be identified from them (see docs/billing-setup.md).
create table public.trial_claims (
  claim_hash text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from anon, authenticated;

-- The same person under different spellings of one address: lower case, no "+tag", and (gmail only) no dots.
create function private.email_key(p text) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_local text;
  v_domain text;
begin
  if p is null or position('@' in p) = 0 then return null; end if;
  v_local := split_part(lower(trim(p)), '@', 1);
  v_domain := split_part(lower(trim(p)), '@', 2);
  if v_local = '' or v_domain = '' then return null; end if;
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  if v_local = '' then return null; end if;
  return v_local || '@' || v_domain;
end;
$$;

-- The keyed hash stored in trial_claims. p_kind keeps the two kinds of record ('email', 'user') apart. FAILS CLOSED:
-- a missing or short key raises an error instead of hashing with an empty key (which anyone could reproduce).
create function private.claim_hash(p_kind text, p_value text, p_secret text) returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'Team creation is not available right now (server setup is incomplete).' using errcode = 'P0001';
  end if;
  return encode(extensions.hmac(p_kind || ':' || p_value, p_secret, 'sha256'), 'hex');
end;
$$;

-- Records that these people have had their trial. Safe to run again (existing records are kept). Called once for the
-- existing businesses (below, or by scripts/backfill-trial-claims.mjs), never by users.
create function public.backfill_trial_claims(p_secret text) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int := 0;
  v_k int;
begin
  perform private.claim_hash('email', 'x', p_secret); -- fail closed on a missing key
  insert into public.trial_claims (claim_hash)
  select distinct private.claim_hash('email', private.email_key(u.email), p_secret)
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.role = 'owner' and private.email_key(u.email) is not null
  on conflict (claim_hash) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  insert into public.trial_claims (claim_hash)
  select distinct private.claim_hash('user', m.user_id::text, p_secret)
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.role = 'owner' and private.email_key(u.email) is not null
  on conflict (claim_hash) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;
revoke execute on function public.backfill_trial_claims(text) from public, anon, authenticated;
grant execute on function public.backfill_trial_claims(text) to service_role;

-- Existing businesses were just given their trial above: that is their owner's one trial. The key is not available to a
-- migration, so the records are written here only when the operator supplied it for this session:
--   select set_config('tempo.trial_claim_secret', '<TRIAL_CLAIM_SECRET>', false);   -- then run this migration
-- Otherwise run `node scripts/backfill-trial-claims.mjs` once after applying (see docs/billing-setup.md).
do $$
declare
  v_secret text := current_setting('tempo.trial_claim_secret', true);
begin
  if coalesce(v_secret, '') <> '' then
    perform public.backfill_trial_claims(v_secret);
  else
    raise notice 'trial_claims were NOT backfilled: run scripts/backfill-trial-claims.mjs once (needs TRIAL_CLAIM_SECRET).';
  end if;
end;
$$;

-- Test and operations helper (service role only): removes the two records of one person. The end-to-end test cleanup
-- uses it so repeated test runs keep earning a trial. Not reachable by users.
create function public.forget_trial_claim(p_secret text, p_user uuid, p_email text) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.trial_claims
  where claim_hash in (
    private.claim_hash('user', p_user::text, p_secret),
    coalesce(private.claim_hash('email', private.email_key(p_email), p_secret), '-')
  );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.forget_trial_claim(text, uuid, text) from public, anon, authenticated;
grant execute on function public.forget_trial_claim(text, uuid, text) to service_role;

-- The most teams one person may own. Change it here (and MAX_OWNED_ORGS in src/lib/billing.ts, for the on-screen text).
create function private.max_owned_orgs() returns int language sql immutable as $$ select 3; $$;

-- New businesses start a 14-day trial, but only the first one per person:
--   * the creator must have a VERIFIED email, and must not have used a trial before: neither under the same normalised
--     email nor with the same account (a changed email on one account does not renew the trial);
--   * otherwise the business starts with no plan (status 'expired'): it can be viewed, and subscribing switches it on.
-- Who the creator is, and the key for the hashes, arrive as transaction-local settings that only create_organization_as()
-- (service role only) sets. Rows created without them (the server/service role directly, imports) get a trial and claim
-- nothing. A creator with no usable key makes the insert fail: nothing is ever claimed with an empty key.
create function private.organizations_start_trial() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := nullif(current_setting('tempo.claim_uid', true), '')::uuid;
  v_secret text := current_setting('tempo.claim_secret', true);
  v_email text;
  v_confirmed timestamptz;
  v_key text;
  v_n_email int;
  v_n_user int;
  v_trial boolean := true;
begin
  if v_uid is not null then
    select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
    v_key := private.email_key(v_email);
    if v_confirmed is null or v_key is null then
      v_trial := false; -- nothing is recorded, so verifying the address and creating another team still earns the trial
    else
      insert into public.trial_claims (claim_hash) values (private.claim_hash('email', v_key, v_secret)) on conflict (claim_hash) do nothing;
      get diagnostics v_n_email = row_count;
      insert into public.trial_claims (claim_hash) values (private.claim_hash('user', v_uid::text, v_secret)) on conflict (claim_hash) do nothing;
      get diagnostics v_n_user = row_count;
      v_trial := v_n_email = 1 and v_n_user = 1;
    end if;
  end if;
  if v_trial then
    insert into public.subscriptions (org_id, status, trial_ends_at)
    values (new.id, 'trial', now() + interval '14 days')
    on conflict (org_id) do nothing;
  else
    -- no trial: already over, and no "trial ended" email (they never had one)
    insert into public.subscriptions (org_id, status, trial_ends_at, trial_ended_email_sent_at)
    values (new.id, 'expired', now(), now())
    on conflict (org_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger organizations_start_trial after insert on public.organizations
  for each row execute function private.organizations_start_trial();

-- Creating a team, on behalf of an already signed-in person (the server passes the id it got from the verified session).
-- SERVICE ROLE ONLY: the key for the trial hashes comes with the call, so it never has to be stored anywhere, and a
-- browser can't call this with an id or key of its own. Same as before, plus the cap on teams per owner.
-- (Replaces the browser-callable create_organization(text, text, text, text).)
drop function if exists public.create_organization(text, text, text, text);
create function public.create_organization_as(p_uid uuid, p_secret text, p_name text, p_slug text, p_timezone text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_member uuid;
  v_owned int;
  d int;
begin
  if p_uid is null or not exists (select 1 from auth.users where id = p_uid) then
    raise exception 'Not authenticated';
  end if;
  perform private.claim_hash('user', p_uid::text, p_secret); -- fail closed before anything is created

  -- two creations (or promotions) at once for the same person take turns, so the cap can't be beaten by a race
  perform pg_advisory_xact_lock(hashtext('owner_cap:' || p_uid::text));
  select count(*) into v_owned from public.memberships where user_id = p_uid and role = 'owner';
  if v_owned >= private.max_owned_orgs() then
    raise exception 'You can own up to % teams. Delete one you no longer need, or contact us if you need more.', private.max_owned_orgs();
  end if;

  perform set_config('tempo.claim_uid', p_uid::text, true);
  perform set_config('tempo.claim_secret', p_secret, true);
  insert into public.organizations (name, slug, timezone, created_by)
  values (p_name, lower(p_slug), coalesce(nullif(p_timezone, ''), 'America/Toronto'), p_uid)
  returning id into v_org;
  perform set_config('tempo.claim_uid', '', true);
  perform set_config('tempo.claim_secret', '', true);

  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, p_uid, 'owner', coalesce(nullif(p_display_name, ''), 'Owner'))
  returning id into v_member;

  for d in 1..5 loop
    insert into public.availability_rules (org_id, member_id, weekday, start_time, end_time)
    values (v_org, v_member, d, '09:00', '17:00');
  end loop;

  return v_org;
end;
$$;
revoke execute on function public.create_organization_as(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_organization_as(uuid, text, text, text, text, text) to service_role;

-- The cap also applies when a membership BECOMES owner (an owner promoting someone, a new owner membership), not only when
-- a team is created. Takes the same lock as create_organization_as. Leaving, demoting and staying an owner are not affected.
create function private.owner_cap_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_owned int;
begin
  if new.role <> 'owner' or new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and old.user_id is not distinct from new.user_id then return new; end if;
  perform pg_advisory_xact_lock(hashtext('owner_cap:' || new.user_id::text));
  select count(*) into v_owned from public.memberships where user_id = new.user_id and role = 'owner' and id <> new.id;
  if v_owned >= private.max_owned_orgs() then
    raise exception 'That person already owns % teams, the most one person can own, so they can''t be made an owner here.', private.max_owned_orgs();
  end if;
  return new;
end;
$$;
create trigger memberships_owner_cap_guard before insert or update of role, user_id on public.memberships
  for each row execute function private.owner_cap_guard();

-- ───────────────────────────── Entitlement and limits ─────────────────────────────
-- Does this business currently have an active plan? Computed from the stored row and the clock, so a trial that
-- runs out stops working at that instant without waiting for a job. Keep in sync with isEntitled() in src/lib/billing.ts.
create function private.billing_entitled(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case s.status
      when 'trial' then s.trial_ends_at > now()
      -- A cancelled-at-period-end plan stops 2 days after the period (slack for a late webhook).
      when 'active' then not (s.cancel_at_period_end and s.current_period_end is not null and s.current_period_end + interval '2 days' < now())
      -- Payment failed: 7 days of grace, counted from the first failure.
      when 'past_due' then coalesce(s.past_due_since, now()) + interval '7 days' > now()
      else false
    end
    from public.subscriptions s where s.org_id = p_org
  ), false); -- fail closed: every business has a row (backfilled above, created by the trigger with the business)
$$;

-- What the plan includes. The trial includes 1 location and 5 staff.
create function private.billing_limits(p_org uuid, out max_locations int, out max_staff int)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select case when s.status = 'trial' then 1 else 1 + s.extra_locations end from public.subscriptions s where s.org_id = p_org), 2147483647),
    coalesce((select case when s.status = 'trial' then 5 else (1 + s.extra_locations) * 5 + s.staff_packs * 5 end from public.subscriptions s where s.org_id = p_org), 2147483647);
$$;

-- ───────────────────────────── Limits: locations and staff ─────────────────────────────
-- Only active locations count (a deactivated one does not use up the plan). Locking the subscription row makes two
-- simultaneous inserts take turns, so the limit can't be beaten by a race.
create function private.locations_limit_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int;
  v_used int;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' then
    if old.active then return new; end if; -- only adding or reactivating uses up a place
  end if;

  if not private.billing_entitled(new.org_id) then
    raise exception 'Your subscription is not active, so locations can''t be added. Subscribe on the Billing page.' using hint = 'billing';
  end if;
  perform 1 from public.subscriptions where org_id = new.org_id for update;
  select l.max_locations into v_max from private.billing_limits(new.org_id) l;
  select count(*) into v_used from public.locations where org_id = new.org_id and active and id <> new.id;
  if v_used + 1 > v_max then
    raise exception 'Your plan includes % location(s). Add a location on the Billing page to continue.', v_max using hint = 'billing';
  end if;
  return new;
end;
$$;
create trigger locations_limit_guard before insert or update of active on public.locations
  for each row execute function private.locations_limit_guard();

-- Every membership counts as staff: owners, admins and members, with or without a login, bookable or not.
-- A pending invitation (one that will add a NEW person) holds a seat too, so invitations can't be handed out beyond
-- the plan. The invitation being accepted is not counted against the person accepting it (matched by email).
create function private.memberships_limit_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int;
  v_used int;
  v_reserved int;
  v_email text;
begin
  -- the first owner of a brand-new business (create_organization_as) always fits, even when no trial applies
  if new.role = 'owner' and not exists (select 1 from public.memberships where org_id = new.org_id) then
    return new;
  end if;
  if not private.billing_entitled(new.org_id) then
    raise exception 'Your subscription is not active, so team members can''t be added. Subscribe on the Billing page.' using hint = 'billing';
  end if;
  perform 1 from public.subscriptions where org_id = new.org_id for update;
  select l.max_staff into v_max from private.billing_limits(new.org_id) l;
  select count(*) into v_used from public.memberships where org_id = new.org_id;
  if new.user_id is not null then
    select lower(u.email) into v_email from auth.users u where u.id = new.user_id;
  end if;
  select count(*) into v_reserved from public.invitations i
  where i.org_id = new.org_id and i.accepted_at is null and i.member_id is null and i.expires_at > now()
    and (v_email is null or lower(i.email) <> v_email);
  if v_used + v_reserved + 1 > v_max then
    raise exception 'Your plan includes % staff. Add a staff pack on the Billing page to continue.', v_max using hint = 'billing';
  end if;
  return new;
end;
$$;
create trigger memberships_limit_guard before insert on public.memberships
  for each row execute function private.memberships_limit_guard();

-- An invitation for a NEW person reserves a seat, so it needs room now. Invitations that link an existing
-- login-less team member add nobody and are not checked.
create function private.invitations_limit_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int;
  v_used int;
  v_reserved int;
begin
  if new.member_id is not null or new.accepted_at is not null then return new; end if;
  if not private.billing_entitled(new.org_id) then
    raise exception 'Your subscription is not active, so people can''t be invited. Subscribe on the Billing page.' using hint = 'billing';
  end if;
  perform 1 from public.subscriptions where org_id = new.org_id for update;
  select l.max_staff into v_max from private.billing_limits(new.org_id) l;
  select count(*) into v_used from public.memberships where org_id = new.org_id;
  select count(*) into v_reserved from public.invitations i
  where i.org_id = new.org_id and i.accepted_at is null and i.member_id is null and i.expires_at > now() and i.id <> new.id;
  if v_used + v_reserved + 1 > v_max then
    raise exception 'Your plan includes % staff. Add a staff pack on the Billing page to continue.', v_max using hint = 'billing';
  end if;
  return new;
end;
$$;
create trigger invitations_limit_guard before insert on public.invitations
  for each row execute function private.invitations_limit_guard();

-- ───────────────────────────── No plan: nothing new can be booked ─────────────────────────────
-- Covers every way in: create_public_booking, the recurring and class RPCs, the embed, the dashboard and the
-- waitlist, because they all end in an insert into these tables.
create function private.billing_insert_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.billing_entitled(new.org_id) then
    raise exception 'This business is not accepting bookings right now.' using hint = 'billing';
  end if;
  return new;
end;
$$;
create trigger bookings_billing_guard before insert on public.bookings
  for each row execute function private.billing_insert_guard();
create trigger class_waitlist_billing_guard before insert on public.class_waitlist
  for each row execute function private.billing_insert_guard();
create trigger class_sessions_billing_guard before insert on public.class_sessions
  for each row execute function private.billing_insert_guard();

-- The public contact form is paused too (it also costs the business's notification emails/texts). The message is
-- shown to the visitor as written.
create function private.inquiries_billing_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.billing_entitled(new.org_id) then
    raise exception 'This business isn''t taking messages through this form right now.' using hint = 'billing';
  end if;
  return new;
end;
$$;
create trigger inquiries_billing_guard before insert on public.inquiries
  for each row execute function private.inquiries_billing_guard();

-- ───────────────────────────── No plan: the dashboard is read-only ─────────────────────────────
-- Restrictive policies are ANDed with the existing ones: whatever a person could write before, they can't now.
-- Reads are untouched (and so is data export). Server-side jobs use the service role and are not affected.
do $$
declare
  t text;
begin
  foreach t in array array[
    'services', 'availability_rules', 'time_off', 'customers', 'bookings', 'shifts', 'locations', 'workflows',
    'inquiries', 'service_questions', 'booking_series', 'class_sessions', 'class_waitlist', 'invitations',
    'workflow_steps', 'calendar_connections'
  ] loop
    execute format('create policy "billing: plan required (insert)" on public.%I as restrictive for insert to authenticated with check (private.billing_entitled(org_id))', t);
    execute format('create policy "billing: plan required (update)" on public.%I as restrictive for update to authenticated using (private.billing_entitled(org_id)) with check (private.billing_entitled(org_id))', t);
    execute format('create policy "billing: plan required (delete)" on public.%I as restrictive for delete to authenticated using (private.billing_entitled(org_id))', t);
  end loop;
end;
$$;
-- Team members: owners/admins can't edit or remove people without a plan. Leaving a team yourself always works.
-- (Adding people is a trigger above; accepting an invitation and creating a team are definer functions.)
create policy "billing: plan required (update)" on public.memberships as restrictive for update to authenticated
  using (private.billing_entitled(org_id)) with check (private.billing_entitled(org_id));
create policy "billing: plan required (delete)" on public.memberships as restrictive for delete to authenticated
  using (private.billing_entitled(org_id) or user_id = (select auth.uid()));

-- Child tables without an org_id of their own: the business is looked up through the row they point to.
create function private.workflow_org(p_workflow uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select org_id from public.workflows where id = p_workflow; $$;
do $$
declare
  t text;
  expr text;
begin
  foreach t in array array['service_staff', 'member_locations', 'workflow_services'] loop
    expr := case t when 'workflow_services' then 'private.billing_entitled(private.workflow_org(workflow_id))'
                   else 'private.billing_entitled(private.member_org(member_id))' end;
    execute format('create policy "billing: plan required (insert)" on public.%I as restrictive for insert to authenticated with check (%s)', t, expr);
    execute format('create policy "billing: plan required (update)" on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t, expr, expr);
    execute format('create policy "billing: plan required (delete)" on public.%I as restrictive for delete to authenticated using (%s)', t, expr);
  end loop;
end;
$$;

-- Business settings (name, hours rules, payments…) are read-only too. Deleting the whole business stays possible.
create policy "billing: plan required (update)" on public.organizations as restrictive for update to authenticated
  using (private.billing_entitled(id)) with check (private.billing_entitled(id));

-- ───────────────────────────── Waitlist promotion must not fail a cancellation ─────────────────────────────
-- Same function as before, except: with no active plan nobody is booked in automatically (the insert would be
-- refused, and that must not roll back the cancellation that freed the spot).
create or replace function private.promote_class_waitlist(p_session uuid) returns int
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
  if not private.billing_entitled(v_s.org_id) then
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

-- ───────────────────────────── Public + team reads ─────────────────────────────
-- Can this business take bookings right now? Used by the public booking page and the embed to show a neutral
-- "not accepting bookings" message. Returns nothing about why.
create function public.org_accepts_bookings(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.billing_entitled(p_org);
$$;
revoke execute on function public.org_accepts_bookings(uuid) from public;
grant execute on function public.org_accepts_bookings(uuid) to anon, authenticated;

-- The plan summary for the dashboard. Owners get the full picture (dates, payment trouble). Everyone else on the team
-- gets only what they need to understand a lock ("the plan isn't active, ask the owner") and the plan's limits:
-- no dates, and a payment problem during the grace period is not shown (they see the plan as normal until it lapses).
create function public.billing_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.subscriptions;
  l record;
  v_owner boolean := private.has_org_role(p_org, array['owner']::public.org_role[]);
begin
  if not private.is_org_member(p_org) then
    return null;
  end if;
  select * into s from public.subscriptions where org_id = p_org;
  if s.org_id is null then return null; end if;
  select * into l from private.billing_limits(p_org);
  return jsonb_build_object(
    'status', case when v_owner or s.status <> 'past_due' then s.status else 'active' end,
    'entitled', private.billing_entitled(p_org),
    'trial_ends_at', case when v_owner then s.trial_ends_at end,
    'current_period_end', case when v_owner then s.current_period_end end,
    'cancel_at_period_end', case when v_owner then s.cancel_at_period_end else false end,
    'past_due_since', case when v_owner then s.past_due_since end,
    'max_locations', l.max_locations,
    'max_staff', l.max_staff
  );
end;
$$;
revoke execute on function public.billing_status(uuid) from public, anon;
grant execute on function public.billing_status(uuid) to authenticated;

-- New helper functions: only signed-in users (policies) and the server may call them.
revoke execute on function private.billing_entitled(uuid) from public, anon;
revoke execute on function private.billing_limits(uuid) from public, anon;
grant execute on function private.billing_entitled(uuid) to authenticated;
grant execute on function private.billing_limits(uuid) to authenticated;
revoke execute on function private.workflow_org(uuid) from public, anon;
grant execute on function private.workflow_org(uuid) to authenticated;

-- The trigger functions are only ever fired by their triggers: nobody needs EXECUTE on them (a trigger's function is
-- permission-checked when the trigger is created, not when it fires).
revoke execute on function private.organizations_start_trial() from public, anon, authenticated;
revoke execute on function private.email_key(text) from public, anon, authenticated;
revoke execute on function private.claim_hash(text, text, text) from public, anon, authenticated;
revoke execute on function private.owner_cap_guard() from public, anon, authenticated;
revoke execute on function private.max_owned_orgs() from public, anon, authenticated;
revoke execute on function private.locations_limit_guard() from public, anon, authenticated;
revoke execute on function private.memberships_limit_guard() from public, anon, authenticated;
revoke execute on function private.invitations_limit_guard() from public, anon, authenticated;
revoke execute on function private.billing_insert_guard() from public, anon, authenticated;
revoke execute on function private.inquiries_billing_guard() from public, anon, authenticated;

-- ───────────────────────────── Definer RPCs must respect the read-only rule too ─────────────────────────────
-- Restrictive RLS doesn't apply inside SECURITY DEFINER functions. These two are callable by any team member, so
-- they check the plan themselves. Same functions as 20261029000000_class_changes.sql, plus that one check (right
-- after the permission check). Grants are kept by CREATE OR REPLACE.
-- (Audit: set_day_shifts, copy_shifts and fill_shifts_from_weekly are SECURITY INVOKER, so the policies above already
-- apply to them; add_team_member and accept_invitation end in the staff-limit trigger, which checks the plan;
-- create_organization_as starts a new business and needs no plan.)
create or replace function public.move_class_booking(p_booking uuid, p_session uuid) returns jsonb
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
  if not private.billing_entitled(v_b.org_id) then
    raise exception 'This business''s subscription isn''t active, so changes are turned off.' using hint = 'billing';
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
create or replace function public.move_class_session(p_session uuid, p_starts_at timestamptz, p_member uuid default null) returns jsonb
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
  if not private.billing_entitled(v_s.org_id) then
    raise exception 'This business''s subscription isn''t active, so changes are turned off.' using hint = 'billing';
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
