-- One row per person per week of startup discovery (plan #1684, feature #1679).
--
-- The weekly cron reads the hiring lists, has Dash shortlist startups, then
-- looks for the job board of each. A row says how far this week's run got, so
-- a second call in the same week does not ask Dash again, and a run cut off by
-- its time budget can be told from one that finished.
--
--   week_start      the Monday (UTC) of the week the run belongs to. One row
--                   per person per week.
--   stage           reading, shortlisting, boards, then done or failed. A row
--                   still short of done or failed long after it started was
--                   cut off by the platform and is run again.
--   shortlisted_at  when the shortlist was written. Set means Dash is not
--                   asked again this week; only the boards step is repeated.
--   offered, added, refreshed   startups shown to Dash, and rows written new
--                   and refreshed.
--   boards_checked, boards_found, boards_left   the board step's result;
--                   left is what stays due for next week.
--   error           why it stopped, in words a page can show.
--
-- Bookkeeping, so listed in lib/jobs/sources.ts as not a source.

set search_path = job_search, extensions;

create table if not exists discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  week_start date not null,
  stage text not null default 'reading',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  shortlisted_at timestamptz,
  offered integer not null default 0,
  added integer not null default 0,
  refreshed integer not null default 0,
  boards_checked integer not null default 0,
  boards_found integer not null default 0,
  boards_left integer not null default 0,
  error text,
  constraint discovery_runs_stage_ck check
    (stage in ('reading', 'shortlisting', 'boards', 'done', 'failed')),
  constraint discovery_runs_error_length_ck check (error is null or length(error) <= 1000),
  constraint discovery_runs_user_week_uk unique (user_id, week_start)
);

alter table discovery_runs enable row level security;

create policy discovery_runs_select on discovery_runs for select to authenticated
  using (user_id = (select auth.uid()));

grant select on discovery_runs to authenticated;
grant all on discovery_runs to service_role;
revoke all on discovery_runs from anon;
