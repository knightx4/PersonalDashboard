-- Appointments booked by email, for the agenda (plan #1127).
--
-- A fourth reader on the shared inbox, beside the commerce, job and
-- recurring-payments linkers (lib/todo/appointments/linker.ts). It claims
-- booking mail by sender and subject (a doctor, a dentist, a haircut, a
-- table), reads the body of what it claimed with Haiku, and files the time and
-- place here. A change moves the appointment and a cancellation marks it
-- cancelled, so the agenda's appointments source shows only what still stands.
--
-- todo.appointments           one row per appointment.
--   title                     what it is: "Dental cleaning", "Dinner for 2"
--   provider, provider_key    who it is with, and that name lowercased to its
--                             letters and digits, which is how a later change
--                             or cancellation finds the row
--   reference                 the booking's confirmation number, when the
--                             mail gives one
--   starts_on                 the day, in the person's own zone
--   starts_at, ends_at        the instants, when the mail gives a time
--   status                    'booked' or 'cancelled'
--   as_of                     when the email that last changed the row
--                             arrived. Mail is read newest first and older
--                             mail can arrive later through the catch-up, so
--                             an email older than this changes nothing.
--
-- todo.appointment_messages   the linker's verdict on each message it was
--                             offered, keyed by the core message id, as
--                             public.recurring_messages is for bills.
--
-- Appointments are a source for Goals (lib/todo/sources.ts); the verdicts are
-- bookkeeping.
--
-- This file also replaces core.scrub_unclaimed_messages() so a message this
-- linker claimed keeps its sender and subject. It is here rather than in
-- supabase/migrations because the todo schema is built after that folder
-- (scripts/db-reset.sh); a later migration that replaces the scrub must keep
-- the clause.

set search_path = todo, public, extensions;

create table if not exists todo.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  provider text,
  provider_key text not null,
  reference text,
  starts_on date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  status text not null default 'booked',
  as_of timestamptz not null,
  source_message_id uuid references core.ingested_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_title_ck check (length(title) between 1 and 200),
  constraint appointments_provider_ck check (provider is null or length(provider) <= 200),
  constraint appointments_provider_key_ck check (provider_key ~ '^[a-z0-9]{1,120}$'),
  constraint appointments_reference_ck check (reference is null or length(reference) <= 100),
  constraint appointments_location_ck check (location is null or length(location) <= 300),
  constraint appointments_status_ck check (status in ('booked', 'cancelled')),
  constraint appointments_ends_ck check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index if not exists appointments_user_day_idx
  on todo.appointments (user_id, starts_on);
create index if not exists appointments_user_provider_idx
  on todo.appointments (user_id, provider_key);

drop trigger if exists appointments_touch_updated_at on todo.appointments;
create trigger appointments_touch_updated_at
  before update on todo.appointments
  for each row execute function todo.touch_updated_at();

create table if not exists todo.appointment_messages (
  id uuid primary key references core.ingested_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  claimed boolean not null,
  parse_status text not null,
  error text,
  appointment_id uuid references todo.appointments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_messages_status_ck check (
    parse_status in ('parsed', 'not_appointment', 'unmatched', 'skipped', 'failed')
  ),
  constraint appointment_messages_error_ck check (error is null or length(error) <= 500)
);

create index if not exists appointment_messages_user_idx
  on todo.appointment_messages (user_id);
create index if not exists appointment_messages_appointment_idx
  on todo.appointment_messages (appointment_id) where appointment_id is not null;

-- RLS: every row is its owner's. The linker writes with the service role; the
-- person may correct or remove an appointment.

alter table todo.appointments enable row level security;
alter table todo.appointment_messages enable row level security;

drop policy if exists appointments_select on todo.appointments;
create policy appointments_select on todo.appointments for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists appointments_update on todo.appointments;
create policy appointments_update on todo.appointments for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists appointments_delete on todo.appointments;
create policy appointments_delete on todo.appointments for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists appointment_messages_select on todo.appointment_messages;
create policy appointment_messages_select on todo.appointment_messages for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on todo.appointments from public, anon, authenticated;
revoke all on todo.appointment_messages from public, anon, authenticated;
grant select, delete on todo.appointments to authenticated;
grant update (title, provider, starts_on, starts_at, ends_at, location, status, updated_at)
  on todo.appointments to authenticated;
grant select on todo.appointment_messages to authenticated;
grant select, insert, update, delete on todo.appointments to service_role;
grant select, insert, update, delete on todo.appointment_messages to service_role;

comment on table todo.appointments is
  'Appointments and reservations booked by email, for the agenda (plan #1127).';
comment on table todo.appointment_messages is
  'The appointments linker''s verdict on each message it was offered (plan #1127).';

-- ---------------------------------------------------------------------------
-- A message the appointments linker claimed keeps its sender and subject.
--
-- The function from supabase/migrations/0115_recurring_payments.sql with one
-- more "not claimed" clause. Like that one, it does not wait for this
-- linker's verdict: the linker runs in the same fan-out before the scrub.
-- ---------------------------------------------------------------------------

create or replace function core.scrub_unclaimed_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  scrubbed integer;
begin
  with unclaimed as (
    select m.id
    from core.ingested_messages m
    where m.scrubbed_at is null
      and exists (select 1 from public.ingested_messages c where c.id = m.id)
      and exists (select 1 from job_search.ingested_messages j where j.id = m.id)
      and not exists (
        select 1 from public.ingested_messages c
        where c.id = m.id
          and c.classification is distinct from 'not_relevant'::public.message_classification
      )
      and not exists (
        select 1 from job_search.ingested_messages j
        where j.id = m.id
          and j.classification is distinct from 'not_relevant'::job_search.message_classification
      )
      and not exists (
        select 1 from public.recurring_messages r
        where r.id = m.id and r.claimed
      )
      and not exists (
        select 1 from todo.appointment_messages a
        where a.id = m.id and a.claimed
      )
  )
  update core.ingested_messages m
  set subject = null,
      from_address = null,
      reply_to_address = null,
      thread_id = null,
      scrubbed_at = now()
  from unclaimed u
  where m.id = u.id;

  get diagnostics scrubbed = row_count;
  return scrubbed;
end;
$$;

revoke execute on function core.scrub_unclaimed_messages() from public, anon, authenticated;
grant execute on function core.scrub_unclaimed_messages() to service_role;
