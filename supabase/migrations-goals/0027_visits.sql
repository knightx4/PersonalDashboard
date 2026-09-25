-- ===========================================================================
-- When you last opened the Goals home (plan #1019).
--
-- After five or more days away the home opens with a catch-up: what Claude
-- did while you were gone, what is waiting on you, and one next step per
-- goal (docs/GOALS-SPEC.md, "Coming back after time away"). To know that, the
-- page keeps one row per person, written on every visit:
--
--   visits.last_visit_at  the latest time the home was opened
--   visits.away_from      the visit before a gap of five days or more, i.e.
--                         when the time away started
--   visits.back_on        the day (YYYY-MM-DD, the account's zone) you came
--                         back from that gap
--
-- The home shows the catch-up while back_on is today, so it survives going
-- into a goal and back, and is gone the next day. The rule is
-- nextVisit() in lib/goals/catch-up.ts.
--
-- No history trigger. Every other table in the schema records its changes
-- (0001, "history"), but this one changes on every page load and records
-- nothing done to a goal, so a history row per visit would only bury the
-- rows that matter. tests/rls-goals.test.ts names it as the one exception.
-- ===========================================================================

create table goals.visits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_visit_at timestamptz not null default now(),
  away_from timestamptz,
  back_on date,
  constraint visits_away_ck check ((away_from is null) = (back_on is null))
);

alter table goals.visits enable row level security;

create policy visits_select on goals.visits for select to authenticated
  using (user_id = (select auth.uid()));
create policy visits_insert on goals.visits for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy visits_update on goals.visits for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.visits from anon, public;
grant select, insert, update on goals.visits to authenticated;
grant select, insert, update, delete on goals.visits to service_role;

comment on table goals.visits is
  'When the Goals home was last opened, and the time away it came back from (plan #1019). The home leads with a catch-up on the day you return after five or more days.';

notify pgrst, 'reload schema';
