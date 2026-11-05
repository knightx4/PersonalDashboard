-- The daily check of how each model the app calls sends its replies back
-- (plan #2937.7).
--
-- lib/core/model-rules.ts says, per model, where an answer arrives: through
-- a tool, as text, or as a progress note in a thinking block. On 4 November
-- 2026 Opus wrote an answer into a thinking block that came back empty, and
-- it was found only when the person asked again. This run sends each model
-- four small probes at effort low, holds each reply to its rules
-- (lib/dash/quality/model-replies.ts), and writes a Dev note naming the
-- model and the rule when one breaks. It is capped at five cents a run.
--
--   models   07:27 UTC every day, ten minutes after the health run (0279).
--            Kept in core.dash_eval_runs: results holds one entry per probe
--            with its model, kind and broken rule; model lists the models
--            checked; health is null.
--
-- Schema and schedule only: no rows are changed.

set search_path = core, public, extensions;

alter table core.dash_eval_runs drop constraint dash_eval_runs_trigger_ck;
alter table core.dash_eval_runs
  add constraint dash_eval_runs_trigger_ck check (trigger in ('nightly', 'manual', 'health', 'monthly', 'models'));

comment on column core.dash_eval_runs.trigger is
  'health: the free daily read of real answers, no cases asked. monthly: every case. manual: run_dash_quality(), one case or all. models: the daily probe of how each model''s replies come back (0297). nightly: the schedule before 0279.';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the model reply schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'dash-quality-models-daily'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'dash-quality-models-daily',
      '27 7 * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/dash-quality?trigger=models',
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
