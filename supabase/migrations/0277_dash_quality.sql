-- The nightly check that Ask Dash still answers well.
--
-- Unit tests run the loop against a scripted model, so they cannot see a
-- prompt that has outgrown its budget or a lookup that times out on the real
-- rows. Both happened in October 2026: recall failed every time for three
-- days and nobody knew, and answers ran out of budget after three lookups.
-- This keeps a set of real questions, asks them of the deployed Dash every
-- night against the real model and the owner's rows, grades each answer, and
-- works out how the day's real answers went. A failure writes a Dev note, and
-- the daily Dash quality session (.claude/skills/dash-quality/SKILL.md)
-- reads the runs and fixes what broke.
--
--   core.dash_eval_cases   the questions and what a good answer must show.
--     question   what is asked, as the person would ask it.
--     expect     what the answer is graded on (lib/dash/quality/grade.ts):
--                { mentions_all, mentions_any, mentions_none, cites_any,
--                  max_lookups, max_seconds, allow_failed_lookups }.
--     origin     where the case came from: a turn id, a note id, or a line
--                saying why it was written.
--     active     false keeps a retired case without asking it.
--
--   core.dash_eval_runs    one row per run.
--     trigger    'nightly' from the schedule, 'manual' from run_dash_quality().
--     deploy     the commit the deployed app was built from, when known.
--     results    one entry per case: question, passed, failures, body, stop,
--                lookups, seconds, cost.
--     health     the last 24 hours of real answers (lib/dash/quality/health.ts):
--                counts, rates, failing tools, tokens and cost, and alerts.
--     note_id    the Dev note the run wrote, null when all was well.
--
-- Bookkeeping, not sources (lib/core/sources.ts). Schema and schedule only:
-- the cases are written by the session that finds a failure, against the
-- owner's id, through scripts/sql.ts.

set search_path = core, public, extensions;

create table core.dash_eval_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  expect jsonb not null default '{}'::jsonb,
  origin text,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint dash_eval_cases_question_ck check (btrim(question) <> '' and char_length(question) <= 2000),
  constraint dash_eval_cases_expect_ck check (jsonb_typeof(expect) = 'object')
);

create index dash_eval_cases_user_idx on core.dash_eval_cases (user_id) where active;

create table core.dash_eval_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null,
  deploy text,
  model text not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  cases int not null default 0,
  passed int not null default 0,
  results jsonb not null default '[]'::jsonb,
  health jsonb,
  cost_micros bigint,
  note_id uuid,
  error text,

  constraint dash_eval_runs_trigger_ck check (trigger in ('nightly', 'manual')),
  constraint dash_eval_runs_results_ck check (jsonb_typeof(results) = 'array')
);

create index dash_eval_runs_user_started_idx on core.dash_eval_runs (user_id, started_at desc);

alter table core.dash_eval_cases enable row level security;
alter table core.dash_eval_runs enable row level security;

create policy dash_eval_cases_all on core.dash_eval_cases for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy dash_eval_runs_all on core.dash_eval_runs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.dash_eval_cases from anon;
revoke all on core.dash_eval_runs from anon;
grant select, insert, update, delete on core.dash_eval_cases to authenticated, service_role;
grant select, insert, update, delete on core.dash_eval_runs to authenticated, service_role;

comment on table core.dash_eval_cases is
  'Questions the nightly Dash check asks, and what a good answer must show (lib/dash/quality/grade.ts).';
comment on table core.dash_eval_runs is
  'One row per nightly or manual Dash check: each case graded, and the last day of real answers (lib/dash/quality).';

-- ---------------------------------------------------------------------------
-- Start a run now, from a session after a deploy: `select core.run_dash_quality()`
-- through scripts/sql.ts. The run itself happens in the app; this only posts
-- to it, as the schedule does, and returns the pg_net request id. The result
-- lands in core.dash_eval_runs within a few minutes.
-- ---------------------------------------------------------------------------
create or replace function core.run_dash_quality()
returns bigint
language plpgsql
security definer
set search_path = core, public, extensions, pg_temp
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_origin')
      || '/api/cron/dash-quality?trigger=manual',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function core.run_dash_quality() from public, anon, authenticated;
grant execute on function core.run_dash_quality() to service_role;

-- The nightly run, at 07:17 UTC (03:17 or 02:17 in New York), so the morning
-- session finds it. Guarded as 0255 is, so the local test database resets.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the Dash quality schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'dash-quality-nightly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'dash-quality-nightly',
      '17 7 * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/dash-quality?trigger=nightly',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 300000
        )
      $job$
    )
  $schedule$;
end;
$$;
