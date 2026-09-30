-- The clock behind Maya's automatic thoughts (plan #1289).
--
-- `/api/cron/maya-gate` reads each person's vault notes that changed in the
-- last 36 hours, asks Jev once per note version whether it holds a live
-- question (obsidian.maya_gate_checks, vault migration 0028), and has Maya
-- write a thought on the few Jev is sure of, at most three a day. Vercel's
-- free plan allows one cron a day, so the clock lives in the database, as for
-- the weekly connections in 0107: `pg_cron` for the schedule and `pg_net` for
-- the POST.
--
-- Every hour at 47 minutes past. The daily vault sync runs at 12:33 UTC, so
-- the 12:47 tick is the first to see a day's notes; the others find nothing
-- new and return after three reads.
--
-- The origin and the secret come from Supabase Vault at fire time, under the
-- names 0078 already requires: app_origin and cron_secret. Nothing new has to
-- be set.
--
-- The reply is waited on for up to 295 seconds, the route's own limit less a
-- margin, so its answer lands in net._http_response.
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
      'pg_cron/pg_net not available here -- skipping the Maya gate schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'maya-gate-hourly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'maya-gate-hourly',
      '47 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/maya-gate',
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
