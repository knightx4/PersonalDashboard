-- The clock behind the Level 4 topic import (plan #2016.1).
--
-- `/api/cron/topic-import` adds the Level 4 articles, reads their other
-- names and embeds their titles, a few minutes of work per call. This job
-- calls it every ten minutes, but only while something is left: no Level 4
-- article yet, an article whose names are unread, or a title with no vector.
-- Once all three are done the job fires nothing. Re-running the import to
-- pick up articles added to Wikipedia's list is a call by hand with
-- `?refresh=1`.
--
-- At five past and every ten minutes after, clear of the hourly jobs at
-- seventeen, twenty-nine and forty-one past and the YouTube tick at
-- fifty-three. A call stops itself before four minutes, so two never overlap.
--
-- The origin and the secret come from Supabase Vault at fire time, under the
-- names 0078 already requires: app_origin and cron_secret. Unschedule-then-
-- schedule by name, and guarded on the extensions so the local test
-- database, which has neither, still resets.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the topic import schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'topic-import-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'topic-import-tick',
      '5-59/10 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/topic-import',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 295000
        )
        where not exists (select 1 from learn.area_check_articles where level = 4)
           or exists (select 1 from learn.area_check_articles where aliases is null)
           or exists (select 1 from learn.area_check_articles where embedding is null)
      $job$
    )
  $schedule$;
end;
$$;
