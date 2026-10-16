-- Tempo — two options for the website contact form:
--   * which services appear in the "service you're interested in" list (services.contact_form), and
--   * the text visitors see after sending (organizations.inquiry_success_message; empty = the default wording).

alter table public.services add column contact_form boolean not null default true;
comment on column public.services.contact_form is 'Whether this service is offered in the website contact form''s service list.';

alter table public.organizations
  add column inquiry_success_message text check (inquiry_success_message is null or char_length(inquiry_success_message) <= 500);
comment on column public.organizations.inquiry_success_message is 'Shown to a visitor after they send a website message. Empty = Tempo''s default thank-you.';

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
      'currency', o.currency, 'inquiries_enabled', o.inquiries_enabled,
      'success_message', o.inquiry_success_message
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug) order by s.position, s.created_at)
      from public.services s where s.org_id = o.id and s.active and s.contact_form
    ), '[]'::jsonb)
  )
  from public.organizations o where o.slug = p_slug;
$$;

-- A service the business hides from the form can't be attached by a hand-made request either.
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.create_public_inquiry(uuid,uuid,text,text,text,text,text)'::regprocedure);
  patched := replace(def, 'where s.id = p_service and s.org_id = p_org and s.active;', 'where s.id = p_service and s.org_id = p_org and s.active and s.contact_form;');
  if patched = def then raise exception 'service check was not patched'; end if;
  execute patched;
end $$;
