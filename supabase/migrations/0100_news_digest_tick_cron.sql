-- The clock behind the newsletter catch-up (plan #787).
--
-- A newsletter is summarised when it arrives, from the inbound route. This
-- hourly job summarises whatever that left pending: the issues stored before
-- summaries existed, and any arrival whose summary did not run.
-- `/api/cron/news-digest` takes up to ten issues with no digested_at per call,
-- so the 42 stored when this was written are done within five hours, and a
-- call with nothing pending makes no model call. The schedule lives in the
-- database for the reason 0099 gives: Vercel's free plan allows one cron a
-- day.
--
-- Hourly, at twenty-nine minutes past, clear of theme placement at seventeen
-- past and the Learn now top-up at forty-one past.
--
-- The origin and the secret come from Supabase Vault at fire time, under the
-- names 0078 already requires: app_origin and cron_secret.
--
-- Unschedule-then-schedule by name, so applying this twice leaves one job, and
-- guarded on the extensions so the local test database, which has neither,
-- still resets.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the newsletter catch-up schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'news-digest-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'news-digest-tick',
      '29 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/news-digest',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 295000
        )
      $job$
    )
  $schedule$;
end;
$$;
