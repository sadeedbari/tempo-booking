-- Tempo — invitation lookup and write-protection for payment fields.

-- Lets someone holding an invite link see which team it's for.
create or replace function public.get_invitation(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'email', i.email,
    'role', i.role,
    'valid', i.accepted_at is null and i.expires_at > now()
  )
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token and length(p_token) >= 32;
$$;
revoke execute on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- Stripe fields can only be changed by the server (service role).
-- These run as the caller (security invoker) so auth.role() reflects who is writing.
create or replace function public.guard_org_payment_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.stripe_account_id is distinct from old.stripe_account_id
      or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled)
     and coalesce((select auth.role()), '') in ('anon', 'authenticated') then
    raise exception 'Payment settings can only be changed by connecting Stripe';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_org_payment_fields() from public, anon, authenticated;

create trigger organizations_guard_payment_fields
  before update on public.organizations
  for each row execute function public.guard_org_payment_fields();

-- Bookings: payment fields likewise only change through Stripe webhooks.
create or replace function public.guard_booking_payment_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.payment_status is distinct from old.payment_status
      or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
      or new.manage_token is distinct from old.manage_token
      or new.org_id is distinct from old.org_id)
     and coalesce((select auth.role()), '') in ('anon', 'authenticated') then
    raise exception 'These booking fields cannot be changed directly';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_booking_payment_fields() from public, anon, authenticated;

create trigger bookings_guard_payment_fields
  before update on public.bookings
  for each row execute function public.guard_booking_payment_fields();
