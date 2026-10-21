-- The Dash check asks its cases once a month, and reads the real answers
-- every day for nothing (0277).
--
-- Asking every case each night cost about a dollar, some $30 a month, which
-- the person judged too much for a test. The check now has two runs:
--
--   health   07:17 UTC every day but the 1st. No model call: it reads the
--            last day of real answers, their lookups, the thumbs and what
--            the person wrote back, and writes a Dev note when anything went
--            wrong.
--   monthly  07:17 UTC on the 1st. Asks every active case, as 0277's nightly
--            run did, and works out that day's health in place of the daily
--            run.
--
-- run_dash_quality(case) now takes a case id, so a session that has fixed one
-- failure re-asks that one question, at a few cents, rather than all of them.
--
-- Schema and schedule only: no rows are changed.

set search_path = core, public, extensions;

alter table core.dash_eval_runs drop constraint dash_eval_runs_trigger_ck;
alter table core.dash_eval_runs
  add constraint dash_eval_runs_trigger_ck check (trigger in ('nightly', 'manual', 'health', 'monthly'));

comment on column core.dash_eval_runs.trigger is
  'health: the free daily read of real answers, no cases asked. monthly: every case. manual: run_dash_quality(), one case or all. nightly: the schedule before 0279.';

drop function if exists core.run_dash_quality();

create or replace function core.run_dash_quality(p_case uuid default null)
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
      || '/api/cron/dash-quality?trigger=manual'
      || coalesce('&case=' || p_case::text, ''),
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

revoke all on function core.run_dash_quality(uuid) from public, anon, authenticated;
grant execute on function core.run_dash_quality(uuid) to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the Dash quality schedules. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job
     where jobname in ('dash-quality-nightly', 'dash-quality-health-daily', 'dash-quality-monthly')
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'dash-quality-health-daily',
      '17 7 2-31 * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/dash-quality?trigger=health',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        )
      $job$
    )
  $schedule$;

  execute $schedule$
    select cron.schedule(
      'dash-quality-monthly',
      '17 7 1 * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/dash-quality?trigger=monthly',
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
