-- A fit score on each discovered startup, and a discovery run the person can
-- start from Find (feature #1679, after its first week).
--
--   fit_score   Dash's score from 1 to 100 for how well the startup fits what
--               the person wants, written with the shortlist. Find lists the
--               watchlist best match first. Null on rows shortlisted before the
--               score existed, until the next run refreshes them.
--
-- The Find startups button runs discovery in the person's own session, so
-- discovery_runs, which only the weekly cron wrote, now takes their own
-- inserts and updates as well. Rows are still one per person per week.

set search_path = job_search, extensions;

alter table watchlist_startups add column if not exists fit_score smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'watchlist_startups_fit_score_ck') then
    alter table watchlist_startups add constraint watchlist_startups_fit_score_ck
      check (fit_score is null or fit_score between 1 and 100);
  end if;
end $$;

create index if not exists watchlist_startups_user_score_idx
  on watchlist_startups (user_id, fit_score desc nulls last);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'job_search'
                 and tablename = 'discovery_runs' and policyname = 'discovery_runs_insert') then
    create policy discovery_runs_insert on discovery_runs for insert to authenticated
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'job_search'
                 and tablename = 'discovery_runs' and policyname = 'discovery_runs_update') then
    create policy discovery_runs_update on discovery_runs for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;

grant insert, update on discovery_runs to authenticated;
