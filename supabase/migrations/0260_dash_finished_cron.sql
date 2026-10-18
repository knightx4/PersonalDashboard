-- The five-minute clock behind the finished-work notification (plan #2389.3).
--
-- `/api/cron/dash-finished` sends one phone notification to each person whose
-- Dash has no run in progress and has finished something since the last one
-- (inngest/core/dash-finished.ts), and records how far it announced in
-- public.dash_finish_notifications (0259). Every five minutes, so the
-- notification arrives within a few minutes of the last run ending.
--
-- The schedule lives in the database for the reason 0099 gives: Vercel's free
-- plan allows one cron a day. The origin and the secret come from Supabase
-- Vault at fire time, under the names 0078 already requires: app_origin and
-- cron_secret. Nothing new has to be set.
--
-- Unschedule-then-schedule by name, so applying this twice leaves one job, and
-- guarded on the extensions so the local test database, which has neither,
-- still resets. No rows are changed.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the finished-work schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'dash-finished-five-minutes'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'dash-finished-five-minutes',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/dash-finished',
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
