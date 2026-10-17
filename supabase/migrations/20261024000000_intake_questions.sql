-- Tempo — intake questions.
--
-- A business adds questions to a service ("Any allergies?"). Customers answer them on the booking form and the
-- team sees the answers on the booking.
--   * service_questions: the questions, per service (a team's admins edit them; every member can read them).
--   * bookings.answers: a snapshot of what was asked and answered, so rewording or deleting a question later never
--     changes what an old booking says.
--   * create_public_booking(...) gains p_answers (a JSON object of question id -> answer). The answers are checked
--     here, not in the app: required questions, the options of choice questions, dates and lengths.
--   * get_public_org() lists each service's questions for the booking form.

alter table public.bookings add column answers jsonb;
comment on column public.bookings.answers is 'Intake answers as asked: [{id, label, type, value}], where value is text or a list of options.';

create table public.service_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  help_text text check (help_text is null or char_length(help_text) <= 300),
  type text not null check (type in ('text', 'paragraph', 'choice', 'multi', 'yes_no', 'agree', 'date')),
  -- the choices of a 'choice' or 'multi' question: a JSON list of 2 to 12 short texts
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 12),
  required boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint service_questions_choices check (type not in ('choice', 'multi') or jsonb_array_length(options) >= 2)
);
create index service_questions_service_idx on public.service_questions (service_id, position, created_at);

-- At most 12 questions per service.
create or replace function public.service_questions_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.service_questions where service_id = new.service_id) >= 12 then
    raise exception 'A service can have at most 12 questions.';
  end if;
  return new;
end $$;
create trigger service_questions_limit before insert on public.service_questions
  for each row execute function public.service_questions_limit();

alter table public.service_questions enable row level security;
create policy "service questions: members read" on public.service_questions for select to authenticated
  using (private.is_org_member(org_id));
create policy "service questions: admins write" on public.service_questions for all to authenticated
  using (private.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (private.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- ───────────────────────── Checking and snapshotting the answers ─────────────────────────
-- Returns the snapshot to store (a JSON list, or null when nothing was answered). Raises a plain-words error
-- when a required question is empty or an answer isn't one of the allowed choices.
create or replace function public.build_intake_answers(p_service uuid, p_answers jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  q public.service_questions;
  raw jsonb;
  s text;
  item text;
  opts text[];
  picked text[];
  result jsonb := '[]'::jsonb;
  value jsonb;
begin
  if p_answers is not null and (jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 30000) then
    raise exception 'Please check your answers and try again.';
  end if;

  for q in select * from public.service_questions where service_id = p_service order by position, created_at loop
    raw := case when p_answers is null then null else p_answers -> q.id::text end;
    value := null;

    if q.type in ('text', 'paragraph') then
      if raw is not null and jsonb_typeof(raw) = 'string' then
        s := trim(raw #>> '{}');
        if s <> '' then value := to_jsonb(left(s, case when q.type = 'text' then 300 else 2000 end)); end if;
      end if;

    elsif q.type = 'choice' then
      if raw is not null and jsonb_typeof(raw) = 'string' then
        s := trim(raw #>> '{}');
        if s <> '' then
          if not (q.options @> to_jsonb(s)) then
            raise exception 'Please choose one of the listed options for "%".', q.label;
          end if;
          value := to_jsonb(s);
        end if;
      end if;

    elsif q.type = 'multi' then
      if raw is not null and jsonb_typeof(raw) = 'array' then
        picked := '{}';
        for item in select jsonb_array_elements_text(raw) loop
          if not (q.options @> to_jsonb(item)) then
            raise exception 'Please choose only from the listed options for "%".', q.label;
          end if;
          if not (item = any (picked)) then picked := picked || item; end if;
        end loop;
        if coalesce(array_length(picked, 1), 0) > 0 then
          -- keep the business's order of choices
          select jsonb_agg(o) into value from jsonb_array_elements_text(q.options) o where o = any (picked);
        end if;
      end if;

    elsif q.type = 'yes_no' then
      s := lower(trim(coalesce(raw #>> '{}', '')));
      if s in ('yes', 'true') then value := to_jsonb('Yes'::text);
      elsif s in ('no', 'false') then value := to_jsonb('No'::text);
      elsif s <> '' then raise exception 'Please answer yes or no for "%".', q.label;
      end if;

    elsif q.type = 'agree' then
      s := lower(trim(coalesce(raw #>> '{}', '')));
      if s in ('true', 'yes', 'on', 'agreed') then value := to_jsonb('Agreed'::text); end if;

    elsif q.type = 'date' then
      s := trim(coalesce(raw #>> '{}', ''));
      if s <> '' then
        if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Please enter a valid date for "%".', q.label; end if;
        begin
          perform s::date;
        exception when others then
          raise exception 'Please enter a valid date for "%".', q.label;
        end;
        value := to_jsonb(s);
      end if;
    end if;

    if value is null then
      if q.required then
        if q.type = 'agree' then raise exception 'Please tick "%" to continue.', q.label; end if;
        raise exception 'Please answer: %', q.label;
      end if;
    else
      result := result || jsonb_build_array(jsonb_build_object('id', q.id, 'label', q.label, 'type', q.type, 'value', value));
    end if;
  end loop;

  return case when jsonb_array_length(result) = 0 then null else result end;
end $$;
revoke execute on function public.build_intake_answers(uuid, jsonb) from public, anon, authenticated;

-- ───────────────────────── The booking form's data ─────────────────────────
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.get_public_org(text)'::regprocedure);
  patched := replace(
    def,
    $q$'staff_ids', coalesce((select jsonb_agg(ss.member_id) from public.service_staff ss where ss.service_id = s.id), '[]'::jsonb)$q$,
    $q$'staff_ids', coalesce((select jsonb_agg(ss.member_id) from public.service_staff ss where ss.service_id = s.id), '[]'::jsonb),
        'questions', coalesce((
          select jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label, 'help_text', q.help_text, 'type', q.type, 'options', q.options, 'required', q.required) order by q.position, q.created_at)
          from public.service_questions q where q.service_id = s.id
        ), '[]'::jsonb)$q$
  );
  if patched = def then raise exception 'get_public_org was not patched'; end if;
  execute patched;
end $$;

-- ───────────────────────── Booking with answers ─────────────────────────
-- A new version of create_public_booking with a trailing p_answers parameter. The old version is dropped so a call
-- by name can only mean one function.
do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.create_public_booking(uuid,uuid,uuid,timestamp with time zone,text,text,text,text,uuid,text)'::regprocedure);

  patched := replace(def, 'p_address text DEFAULT NULL::text)', 'p_address text DEFAULT NULL::text, p_answers jsonb DEFAULT NULL::jsonb)');
  if patched = def then raise exception 'signature was not patched'; end if;
  def := patched;

  patched := replace(def, E'  v_address text;\nbegin', E'  v_address text;\n  v_answers jsonb;\nbegin');
  if patched = def then raise exception 'declaration was not patched'; end if;
  def := patched;

  patched := replace(
    def,
    'select exists (select 1 from public.locations where org_id = p_org and active) into v_has_locations;',
    E'v_answers := public.build_intake_answers(v_svc.id, p_answers);\n\n  select exists (select 1 from public.locations where org_id = p_org and active) into v_has_locations;'
  );
  if patched = def then raise exception 'answers check was not patched'; end if;
  def := patched;

  patched := replace(def, 'currency, payment_status, source' || E'\n    ) values (', 'currency, payment_status, source, answers' || E'\n    ) values (');
  if patched = def then raise exception 'insert columns were not patched'; end if;
  def := patched;

  patched := replace(def, E'v_org.currency, v_pay, ''online''\n    ) returning', E'v_org.currency, v_pay, ''online'', v_answers\n    ) returning');
  if patched = def then raise exception 'insert values were not patched'; end if;

  execute patched;
end $$;

drop function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid, text);
revoke execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb) from public;
grant execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb) to anon, authenticated;
