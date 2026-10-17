-- Tempo — one calendar event per class session.
--
-- A class with 8 people is one event on the instructor's Google or Outlook calendar, not eight. This remembers the
-- event Tempo created for a session on each connected calendar (the same job booking_calendar_events does for bookings).

create table public.session_calendar_events (
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  event_id text not null,
  primary key (session_id, connection_id)
);
create index session_calendar_events_connection_idx on public.session_calendar_events (connection_id);
alter table public.session_calendar_events enable row level security;
