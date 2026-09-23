-- The clock behind theme placement (docs/LEARN-AREAS-SPEC.md, "Placement").
--
-- `/api/cron/theme-placement` places every vault theme that has no field yet
-- in learn.theme_fields. New themes arrive whenever the vault map sweep runs,
-- so something has to call it again, and Vercel's free plan allows one cron a
-- day. The clock lives in the database, the same way as the map sweep's in
-- 0094: `pg_cron` for the schedule and `pg_net` for the POST.
--
-- Hourly, at seventeen minutes past so it does not land on the hour with the
-- other jobs. When every theme is placed a call costs two reads.
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
      'pg_cron/pg_net not available here -- skipping the theme placement schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'theme-placement-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'theme-placement-tick',
      '17 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/theme-placement',
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
