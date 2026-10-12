-- Tempo — approve booking requests per service instead of per business.
-- services.auto_approve = true (default): online bookings for this service are confirmed straight away.
-- false: they arrive as requests (pending_approval) that an owner/admin confirms or rejects.
-- organizations.booking_confirmation is no longer used by the app; existing 'manual' teams keep their
-- behaviour because their services are switched to "approve manually" below.

alter table public.services add column auto_approve boolean not null default true;

update public.services s
set auto_approve = false
from public.organizations o
where o.id = s.org_id and o.booking_confirmation = 'manual';

comment on column public.services.auto_approve is 'true: online bookings are confirmed automatically; false: they are held as requests until an owner/admin approves or declines them.';

-- Patch the two public functions from their live definitions so nothing else about them changes.
do $$
declare
  def text;
  patched text;
begin
  -- Creating a booking: hold it as a request when this service isn't auto-approved.
  def := pg_get_functiondef('public.create_public_booking(uuid,uuid,uuid,timestamp with time zone,text,text,text,text,uuid,text)'::regprocedure);
  patched := replace(def, 'elsif v_org.booking_confirmation = ''manual'' then', 'elsif not v_svc.auto_approve then');
  if patched = def then raise exception 'create_public_booking was not patched'; end if;
  execute patched;

  -- Booking page data: tell the page which services need approval.
  def := pg_get_functiondef('public.get_public_org(text)'::regprocedure);
  patched := replace(def, '''address_mode'', s.address_mode,', '''address_mode'', s.address_mode, ''auto_approve'', s.auto_approve,');
  if patched = def then raise exception 'get_public_org was not patched'; end if;
  execute patched;
end $$;
