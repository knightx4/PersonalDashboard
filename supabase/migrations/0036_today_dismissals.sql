-- Let "Waiting on you" and "About to go quiet" on /jobs/today be dismissed.
--
-- Both sections are recomputed from the event log and the pipeline on every
-- load, so there is no row on the underlying item itself to mark "done" --
-- unlike a rule-generated reminder. These two small tables hold the
-- dismissal instead: a row means "do not show this one again", and
-- dismissed_until being set is the "Later" half -- null means "Done", for
-- good, same distinction the reminders table already draws with due_at vs
-- completed_at.

create table job_search.waiting_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_event_id uuid not null references job_search.application_events (id) on delete cascade,
  dismissed_until timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, application_event_id)
);

create table job_search.quiet_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references job_search.applications (id) on delete cascade,
  dismissed_until timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, application_id)
);

alter table job_search.waiting_dismissals enable row level security;
alter table job_search.quiet_dismissals enable row level security;

create policy waiting_dismissals_all on job_search.waiting_dismissals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy quiet_dismissals_all on job_search.quiet_dismissals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
