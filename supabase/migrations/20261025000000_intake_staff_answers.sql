-- Tempo — staff can fill in a service's questions when they add a booking by hand.
-- build_intake_answers() gains p_enforce: true (the default, used for online bookings) refuses a missing
-- required answer; false (a booking added by the team) accepts blanks but still checks every answer given.

do $$
declare
  def text;
  patched text;
begin
  def := pg_get_functiondef('public.build_intake_answers(uuid,jsonb)'::regprocedure);

  patched := replace(def, 'p_answers jsonb)', 'p_answers jsonb, p_enforce boolean DEFAULT true)');
  if patched = def then raise exception 'signature was not patched'; end if;
  def := patched;

  patched := replace(def, E'      if q.required then\n        if q.type = ''agree''', E'      if q.required and p_enforce then\n        if q.type = ''agree''');
  if patched = def then raise exception 'required check was not patched'; end if;

  execute patched;
end $$;

drop function public.build_intake_answers(uuid, jsonb);
revoke execute on function public.build_intake_answers(uuid, jsonb, boolean) from public, anon, authenticated;
