-- Checking the inspiration playlist on a schedule and on a button (plan #1411,
-- under #1406).
--
-- `/api/cron/inspiration` reads every inspiration playlist, fetches the new
-- videos' transcripts, reads each new video for takeaways and merges them with
-- the ones already found (lib/dev/inspiration/check.ts). Check now on the tab
-- runs the same thing for one person.
--
-- public.inspiration_settings.run_started_at
--   when the run that is going now began; null when none is. A run claims it
--   before starting and clears it when it ends, so the daily run and Check now
--   never read the same video twice at once. A claim older than ten minutes
--   (CHECK_LOCK_MS) is taken to be a run that died, and is taken over.
--
-- Once a day at 14:35 UTC, clear of the hourly jobs at five, seventeen,
-- twenty-three, twenty-nine, forty-one and forty-seven past. A run that finds
-- nothing new spends nothing, so the daily run costs nothing on most days.
--
-- The origin and the secret come from Supabase Vault at fire time, as 0101
-- reads them: app_origin and cron_secret. Unschedule-then-schedule by name, so
-- applying this twice leaves one job, and guarded on the extensions so the
-- local test database, which has neither, still resets.

set search_path = public, extensions;

alter table public.inspiration_settings add column if not exists run_started_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the inspiration schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'inspiration-daily'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'inspiration-daily',
      '35 14 * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/inspiration',
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
