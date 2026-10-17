-- The Monday clock behind the weekly check of Ask Dash replies (plan #2285.3).
--
-- `/api/cron/ask-reply-check` reads the owner's Ask Dash chats of the
-- Monday-to-Sunday week just gone, New York time, and writes one Dev note
-- listing the replies they marked down or pushed back on
-- (inngest/core/ask-reply-check.ts). A core.ask_reply_checks row (0254) keeps
-- it to one note a week, so the job calls twice, at 13:23 and 19:23 UTC: the
-- second call writes nothing unless the first failed. Both hours are Monday
-- daytime in New York in either season.
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
      'pg_cron/pg_net not available here -- skipping the ask reply check schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'ask-reply-check-weekly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'ask-reply-check-weekly',
      '23 13,19 * * 1',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/ask-reply-check',
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
