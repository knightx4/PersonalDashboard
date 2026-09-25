-- ===========================================================================
-- A goal run's progress while it runs (plan #1002).
--
--   runs.last_seen_at   when the session last reported, written by the goals
--                       skill at each step it starts. Null until the first
--                       report, and the run is then measured from created_at.
--   runs.now_on         a short line saying what the session is on, usually
--                       the step's title. Shown as "on <now_on>, 3 minutes
--                       ago" while the run is started.
--
-- A started run with no report for 45 minutes is closed as failed by a sweep
-- in the daily and overnight ticks (lib/goals/run-sweep.ts). It reads every
-- started run, which the partial index below keeps to a handful of rows.
-- ===========================================================================

alter table goals.runs add column last_seen_at timestamptz;
alter table goals.runs add column now_on text;

alter table goals.runs add constraint runs_now_on_length_ck
  check (now_on is null or length(now_on) <= 300);

create index runs_started_idx on goals.runs (user_id) where status = 'started';

comment on column goals.runs.last_seen_at is
  'When the session last reported progress. The quiet-run sweep measures silence from here, or from created_at before the first report.';

comment on column goals.runs.now_on is
  'What the session said it was on at its last report, usually a step title.';
