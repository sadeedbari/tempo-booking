-- Tempo — "a website message is received" becomes a workflow trigger, so businesses can write (or switch off)
-- the confirmation that visitors get after using the contact form, like any other message in Workflows.
-- Also lets the message log say which inquiry a message was about.

do $$
declare
  c text;
begin
  select conname into c
    from pg_constraint
    where conrelid = 'public.workflows'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%booking_confirmed%';
  if c is not null then
    execute format('alter table public.workflows drop constraint %I', c);
  end if;
end $$;

alter table public.workflows
  add constraint workflows_trigger_check check (trigger in (
    'booking_confirmed', 'booking_requested', 'booking_declined', 'booking_cancelled', 'booking_rescheduled',
    'before_start', 'after_end', 'inquiry_received'
  ));

alter table public.message_log
  add column inquiry_id uuid references public.inquiries (id) on delete set null;
create index message_log_inquiry_idx on public.message_log (inquiry_id) where inquiry_id is not null;
