-- The clock behind the vault's weekly connections (plan #1115).
--
-- `/api/cron/note-connections` looks back over the last seven days of each
-- person's vault and stores up to three connections between notes written in
-- that week and older ones (obsidian.note_connections, vault migration 0025).
-- Vercel's free plan allows one cron a day, so the clock lives in the
-- database, as for the map sweep in 0094: `pg_cron` for the schedule and
-- `pg_net` for the POST.
--
-- Mondays at 13:37 UTC. The daily vault sync runs at 12:33 UTC, so the notes
-- pushed up to Monday morning are in before the week is read. A second call
-- on the same day finds that day's rows and does nothing.
--
-- The origin and the secret come from Supabase Vault at fire time, under the
-- names 0078 already requires: app_origin and cron_secret. Nothing new has to
-- be set.
--
-- The reply is waited on for up to 115 seconds, the route's own limit less a
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
      'pg_cron/pg_net not available here -- skipping the note connections schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'note-connections-weekly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'note-connections-weekly',
      '37 13 * * 1',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/note-connections',
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
