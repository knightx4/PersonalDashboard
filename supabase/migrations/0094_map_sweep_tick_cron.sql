-- The clock behind the vault map's sweep (plan #757).
--
-- `/api/cron/map-sweep` works any running sweep for about four minutes and
-- writes down where it stopped (obsidian.map_sweeps.after_path). Something has
-- to call it again, and Vercel's free plan allows one cron a day, which would
-- take a month over 1,288 notes. So the clock lives in the database, the same
-- way as the overnight tick in 0078: `pg_cron` for the schedule and `pg_net`
-- for the POST.
--
-- Every five minutes. A call spends at most four and holds a lease on the
-- sweep while it does, so two calls never work one sweep. When no sweep is
-- running a call costs one indexed select.
--
-- The origin and the secret come from Supabase Vault at fire time, under the
-- names 0078 already requires: app_origin and cron_secret. Nothing new has to
-- be set.
--
-- The reply is waited on for up to 295 seconds, the route's own limit less a
-- margin, so a call that finishes normally leaves its answer in
-- net._http_response for a few hours, which is where to look when the sweep
-- does not move.
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
      'pg_cron/pg_net not available here -- skipping the map sweep schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'map-sweep-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'map-sweep-tick',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/map-sweep',
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
