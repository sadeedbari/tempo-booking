-- A business whose plan has lapsed must still be able to SHRINK to fit a plan it wants to buy.
-- Subscribing refuses a plan that is smaller than what the business uses ("You use 2 locations but this plan includes 1"),
-- yet the dashboard was read-only, so the owner could not delete the extra location or remove the extra person: a dead end.
-- Deleting only ever lowers usage, so these two deletes no longer need an active plan. Everything else stays read-only
-- (adding, editing, hiding), and only owners/admins can delete, as before (the ordinary policies still apply).
drop policy "billing: plan required (delete)" on public.locations;
drop policy "billing: plan required (delete)" on public.memberships;
