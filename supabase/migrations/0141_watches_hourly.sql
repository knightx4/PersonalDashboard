-- The clock that checks every running watch each hour (plan #1293).
--
-- At twenty-three past each hour pg_cron posts to /api/cron/watches, which
-- reads each running watch's page, stores the reading in core.watch_readings,
-- pushes when a watch fires at a new low or its page has failed three times
-- running, and ends the watches past their ends_at (lib/watch/run.ts).
--
-- Twenty-three past is a minute no other job here uses. The origin and the
-- secret come from Supabase Vault under the names 0078 already requires,
-- app_origin and cron_secret, as for the day brief in 0113; nothing new has
-- to be set.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the watch schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'watches-hourly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'watches-hourly',
      '23 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/watches',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 115000
        )
      $job$
    )
  $schedule$;
end;
$$;
