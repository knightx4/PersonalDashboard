-- When you last opened the Jobs home (plan #1152).
--
-- Home lists what came in since your last visit: replies, rejections,
-- interviews booked, roles the inbox opened or closed. To know where "since"
-- starts, the page keeps one row per person, written on every visit, the same
-- way the Goals home does (migrations-goals/0027_visits.sql):
--
--   home_visits.last_visit_at      the latest time Home was opened
--   home_visits.previous_visit_at  the last visit before this sitting, which
--                                  is where the list starts; null until there
--                                  has been one, when Home looks back 7 days
--
-- Page loads less than 30 minutes apart are one sitting, so reloading Home
-- after acting on something does not empty the list. The rule is
-- nextHomeVisit() in lib/jobs/home/since.ts.
--
-- It has an id as well as the unique user_id because tests/rls-jobs.test.ts
-- checks every table in the schema by id. Bookkeeping, so it is listed in
-- lib/jobs/sources.ts as not a source for Goals.

set search_path = job_search, extensions;

create table if not exists home_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  last_visit_at timestamptz not null default now(),
  previous_visit_at timestamptz
);

alter table home_visits enable row level security;

drop policy if exists home_visits_select on home_visits;
create policy home_visits_select on home_visits for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists home_visits_insert on home_visits;
create policy home_visits_insert on home_visits for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists home_visits_update on home_visits;
create policy home_visits_update on home_visits for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on home_visits to authenticated;
grant all on home_visits to service_role;
revoke all on home_visits from anon;

comment on table home_visits is
  'When the Jobs home was last opened, and the visit before this sitting, where its list of what came in starts (plan #1152).';

notify pgrst, 'reload schema';
