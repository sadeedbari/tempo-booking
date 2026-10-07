-- Bookings can now wait for the business to approve them.
-- Kept in its own migration: a new enum value can't be used until it is committed.
alter type public.booking_status add value if not exists 'pending_approval';
