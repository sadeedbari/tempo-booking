-- Tempo — tighten what the public booking form can send.
-- 1. An email typed or pasted with spaces around it was refused as invalid (it was checked before being trimmed).
-- 2. Nothing stopped a visitor sending megabytes of text in a name or note. Names are cut to 120 characters,
--    phone numbers to 40, notes to 2000, and emails over 254 characters are refused.

do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.create_public_booking(uuid,uuid,uuid,timestamp with time zone,text,text,text,text,uuid,text)'::regprocedure);

  patched := replace(
    def,
    $q$p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'$q$,
    $q$trim(coalesce(p_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(trim(p_email)) > 254$q$
  );
  if patched = def then raise exception 'email check was not patched'; end if;
  def := patched;

  patched := replace(def, $q$values (p_org, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''))$q$, $q$values (p_org, left(trim(p_name), 120), lower(trim(p_email)), nullif(left(trim(p_phone), 40), ''))$q$);
  if patched = def then raise exception 'customer insert was not patched'; end if;
  def := patched;

  patched := replace(def, $q$nullif(trim(p_notes), '')$q$, $q$nullif(left(trim(p_notes), 2000), '')$q$);
  if patched = def then raise exception 'notes were not patched'; end if;

  execute patched;
end $$;
