-- The clock behind committing the vault editor's drafts (note of 20 October
-- 2026; the table is vault 0040).
--
-- `/api/cron/note-drafts` commits each obsidian.note_drafts row that has sat
-- for ten minutes untouched, so a sitting of writing in the app is one commit
-- to the vault rather than one per pause. Every five minutes, so a draft goes
-- out between ten and fifteen minutes after the last keystroke.
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
      'pg_cron/pg_net not available here -- skipping the note drafts schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'note-drafts-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'note-drafts-tick',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/note-drafts',
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
