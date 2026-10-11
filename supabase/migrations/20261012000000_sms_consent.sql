-- Tempo — record that a customer agreed to receive text messages.
-- Texts (confirmations and reminders) are only sent when this is set.
alter table public.customers add column sms_consent_at timestamptz;
comment on column public.customers.sms_consent_at is 'When the customer agreed to receive booking text messages (checkbox on the booking form, or confirmed by staff).';
