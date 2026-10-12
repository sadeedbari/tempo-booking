-- Tempo — workflows: businesses write their own email and text messages to customers.
--
-- A workflow = a trigger (a booking is confirmed / cancelled / ..., or N minutes before the appointment
-- starts or after it ends) plus one or more steps (an email or a text with the message the business wrote).
-- The built-in messages (confirmation, reminder, ...) are workflows too (default_key is set), created for
-- each business the first time it needs them. organizations.reminder_hours_before is no longer used by the app:
-- the built-in reminder workflow takes over its value.

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  trigger text not null check (trigger in (
    'booking_confirmed', 'booking_requested', 'booking_declined', 'booking_cancelled', 'booking_rescheduled',
    'before_start', 'after_end'
  )),
  -- minutes before the start / after the end; only used by before_start and after_end
  offset_minutes int not null default 0 check (offset_minutes between 0 and 10080),
  active boolean not null default true,
  all_services boolean not null default true,
  -- set on the built-in workflows so they can be restored to the original wording
  default_key text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, default_key)
);
create index workflows_org_idx on public.workflows (org_id, trigger) where active;

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  subject text not null default '' check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 5000),
  enabled boolean not null default true,
  position int not null default 0
);
create index workflow_steps_workflow_idx on public.workflow_steps (workflow_id, position);

-- When a workflow only applies to some services (workflows.all_services = false).
create table public.workflow_services (
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (workflow_id, service_id)
);

-- One row per message the system tried to send. dedupe_key stops timed messages (reminders, thank-yous)
-- from going out twice for the same appointment time.
create table public.message_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  workflow_id uuid references public.workflows (id) on delete set null,
  step_id uuid references public.workflow_steps (id) on delete set null,
  workflow_name text not null,
  channel text not null check (channel in ('email', 'sms')),
  recipient text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  detail text,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index message_log_org_idx on public.message_log (org_id, created_at desc);

alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_services enable row level security;
alter table public.message_log enable row level security;

create policy "workflows: admins all" on public.workflows for all to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

create policy "workflow steps: admins all" on public.workflow_steps for all to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

create policy "workflow services: admins all" on public.workflow_services for all to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_id and private.has_org_role(w.org_id, array['owner','admin']::public.org_role[])))
  with check (exists (select 1 from public.workflows w where w.id = workflow_id and private.has_org_role(w.org_id, array['owner','admin']::public.org_role[])));

-- The log is read-only for people; the server (service role) writes it.
create policy "message log: admins read" on public.message_log for select to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));
