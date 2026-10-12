-- Tempo — team members who don't have a login.
-- Small businesses often share one account, or don't want everyone signing in. An owner/admin can now add a
-- team member with just a name: they appear on the calendar and booking page, and the admin manages their hours.
-- An email and an invitation are optional; if the person is invited later, their login is linked to the same
-- team member (keeping their hours, services and bookings).

alter table public.memberships alter column user_id drop not null;
alter table public.memberships add column email text check (email is null or char_length(email) <= 254);
comment on column public.memberships.email is 'Optional contact email for a team member without a login; used if they are invited later.';

-- Only staff can be login-less: owners and admins must be able to sign in.
alter table public.memberships add constraint memberships_login_for_admins check (user_id is not null or role = 'member');

-- An invitation can be for an existing (login-less) team member instead of a brand-new one.
alter table public.invitations add column member_id uuid references public.memberships (id) on delete cascade;

-- Adding a team member without a login. Security definer because people can't insert into memberships directly.
create or replace function public.add_team_member(p_org uuid, p_name text, p_title text, p_email text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  d int;
begin
  if not private.has_org_role(p_org, array['owner','admin']::public.org_role[]) then
    raise exception 'Only owners and admins can add team members';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Enter a name';
  end if;

  insert into public.memberships (org_id, user_id, role, display_name, title, email, color)
  values (
    p_org, null, 'member', trim(p_name),
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    coalesce(nullif(p_color, ''), '#007AFF')
  )
  returning id into v_id;

  -- Same starting hours a new teammate gets today (Mon-Fri 9-5); the admin can change them.
  for d in 1..5 loop
    insert into public.availability_rules (org_id, member_id, weekday, start_time, end_time)
    values (p_org, v_id, d, '09:00', '17:00');
  end loop;
  return v_id;
end;
$$;

revoke execute on function public.add_team_member(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_team_member(uuid, text, text, text, text) to authenticated;

-- Accepting an invitation either creates a new team member (as before) or links the new login to the existing one.
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

  if v_inv.member_id is not null then
    -- Link this login to the team member the admin already set up.
    perform set_config('tempo.linking_member', 'on', true);
    begin
      update public.memberships
      set user_id = v_uid,
          role = v_inv.role,
          email = null,
          display_name = coalesce(nullif(display_name, ''), nullif(p_display_name, ''), split_part(v_email, '@', 1))
      where id = v_inv.member_id and org_id = v_inv.org_id and user_id is null;
    exception when unique_violation then
      raise exception 'You are already a member of this team';
    end;
    if not found then
      raise exception 'This team member already has a login';
    end if;
  else
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
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

-- Role/identity guard: an accepted invitation may attach a login (and role) to a login-less team member.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('tempo.linking_member', true), '') = 'on' then
    return new;
  end if;
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id then
    raise exception 'Membership team and user cannot be changed';
  end if;
  if new.role is distinct from old.role then
    if (select auth.uid()) is not null and not private.has_org_role(new.org_id, array['owner']::public.org_role[])
       and (new.role = 'owner' or old.role = 'owner') then
      raise exception 'Only owners can change owner roles';
    end if;
    if (select auth.uid()) is not null and not private.has_org_role(new.org_id, array['owner','admin']::public.org_role[]) then
      raise exception 'Not allowed to change roles';
    end if;
  end if;
  return new;
end;
$$;
