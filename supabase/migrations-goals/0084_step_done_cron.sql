-- ===========================================================================
-- The five-minute clock behind the done-step phone message (plan #2376.3,
-- feature #2376).
--
-- `/api/cron/goals-step-done` sends one notification for each step with
-- notify_on_done set (0083) that Dash closed as done in the last six hours
-- and whose notified_at is still empty, then sets notified_at
-- (inngest/goals/step-done-notify.ts). Every five minutes, so the message
-- arrives within a few minutes of the close.
--
-- The schedule lives in the database for the reason public 0099 gives:
-- Vercel's free plan allows one cron a day. The origin and the secret come
-- from Supabase Vault at fire time, under the names public 0078 already
-- requires: app_origin and cron_secret. Nothing new has to be set.
--
-- Unschedule-then-schedule by name, so applying this twice leaves one job, and
-- guarded on the extensions so the local test database, which has neither,
-- still resets.
--
-- A partial index keeps the five-minute read to the few rows still waiting.
-- No rows are changed.
-- ===========================================================================

create index if not exists items_notify_due_idx
  on goals.items (closed_at)
  where notify_on_done and notified_at is null;

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the done-step schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'goals-step-done-five-minutes'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'goals-step-done-five-minutes',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/goals-step-done',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
      $job$
    )
  $schedule$;
end;
$$;
