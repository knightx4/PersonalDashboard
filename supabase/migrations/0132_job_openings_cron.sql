-- The clock behind the daily upkeep of Dash's recommended roles.
--
-- `/api/cron/job-openings` reads each open recommended role's posting from its
-- link, takes closed ones off the list, and scores what is new
-- (runOpeningUpkeep in inngest/jobs/suggestions.ts). It used to run inside the
-- daily suggestions call (0117), and with the followed boards and posting reads
-- added that one call could run past its five minutes and be cut off with
-- nothing saved. Each now has its own request.
--
-- Daily at 15:17 UTC, an hour and a half after the searches at 13:47, so what
-- they found is read the same day. The origin and the secret come from
-- Supabase Vault at fire time, as 0117's do.
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
      'pg_cron/pg_net not available here -- skipping the job openings schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'job-openings-daily'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'job-openings-daily',
      '17 15 * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/job-openings',
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
