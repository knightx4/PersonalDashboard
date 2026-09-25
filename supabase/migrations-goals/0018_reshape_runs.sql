-- ===========================================================================
-- Re-shaping a goal once a question on it is answered (plan #1017).
--
-- Answering a question used to change nothing until somebody pressed Work
-- on this again, so the provisional steps it held up stayed provisional. Two
-- additions start that run without a press:
--
--   runs.job 'reshape'   a run fired because questions on one goal were
--                        answered. item_id names the goal, as for 'goal'.
--   goals-reshape-tick   a pg_cron job every ten minutes that calls
--                        /api/cron/goals-reshape. The route fires one run per
--                        goal whose latest answer is ten minutes old and
--                        newer than the goal's last run, so several answers
--                        in a row start one run (inngest/goals/reshape.ts).
--
-- The schedule lives in the database for the reason public 0099 gives:
-- Vercel's free plan allows one cron a day. The origin and the secret come
-- from Supabase Vault at fire time, under the names public 0078 already
-- requires: app_origin and cron_secret. Unschedule-then-schedule by name, so
-- applying this twice leaves one job, and guarded on the extensions so the
-- local test database, which has neither, still resets.
-- ===========================================================================

alter table goals.runs drop constraint runs_job_ck;
alter table goals.runs add constraint runs_job_ck
  check (job in ('daily', 'weekly', 'goal', 'reshape'));

comment on column goals.runs.job is
  'What fired the run: daily (the morning run), weekly (event research), goal (Work on this, or a comment on a goal) or reshape (questions on the goal were answered).';

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the goals re-shape schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'goals-reshape-tick'
  $unschedule$;

  -- Every ten minutes, offset to 3, 13, 23 and so on past the hour, clear of
  -- the other ticks. A call with nothing answered lately reads history once
  -- and fires nothing.
  execute $schedule$
    select cron.schedule(
      'goals-reshape-tick',
      '3-59/10 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/goals-reshape',
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
end;
$$;
