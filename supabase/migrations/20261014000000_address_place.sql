-- Tempo — remember exactly which place a customer's address is (from Google Places suggestions).
-- Lets the dashboard open the precise spot on a map. All three are optional: a typed address still works.
alter table public.bookings
  add column customer_address_place_id text,
  add column customer_address_lat double precision,
  add column customer_address_lng double precision;
