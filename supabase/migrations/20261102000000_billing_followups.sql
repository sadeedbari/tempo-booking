-- Follow-ups to 20261101000000_subscription_billing.sql (that file is already applied to production and is not edited).
--
-- 1. Supabase advisor "function_search_path_mutable": private.max_owned_orgs() was created without a fixed search_path.
--    Every other function added by the billing migration already sets search_path = '' (checked one by one); this was the
--    only one missing. ALTER keeps the function, its body and its grants exactly as they are.
alter function private.max_owned_orgs() set search_path = '';

-- 2. Documentation only: public.forget_trial_claim is kept on purpose (the e2e cleanup and the erasure procedure for the
--    privacy policy use it). It is executable by service_role only; anon and authenticated are refused.
comment on function public.forget_trial_claim(text, uuid, text) is
  'Erasure helper for trial_claims (keyed hashes of an email / user id). service_role only; needs the TRIAL_CLAIM_SECRET. Used by e2e cleanup and by the data-erasure procedure.';
