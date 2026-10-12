-- The weekly clock behind startup discovery (plan #1684, feature #1679).
--
-- `/api/cron/startup-discovery` reads the YC and Hacker News hiring lists,
-- has Dash shortlist startups from them and looks for each one's job board
-- (inngest/jobs/discovery.ts). It runs before the roles search, which is due
-- from 13:47 UTC, so the boards it finds are there when that search reads
-- them. Once a week, Mondays at 06:17 UTC; a second call in the same week
-- finds the week's run recorded and does nothing more.
--
-- The schedule lives in the database for the reason 0099 gives: Vercel's free
-- plan allows one cron a day. The origin and the secret come from Supabase
-- Vault at fire time, under the names 0078 already requires: app_origin and
-- cron_secret. Nothing new has to be set.
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
      'pg_cron/pg_net not available here -- skipping the startup discovery schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'startup-discovery-weekly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'startup-discovery-weekly',
      '17 6 * * 1',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/startup-discovery',
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
