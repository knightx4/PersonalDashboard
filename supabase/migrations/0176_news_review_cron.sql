-- The clock behind the evening review of the day's newsletters (plan #1615,
-- under #1612).
--
-- At 8pm in each person's own timezone Dash writes a review of the 24 hours
-- of newsletters before it into news.daily_reviews. Each person's 8pm falls
-- in a different hour, so this job calls `/api/cron/news-review` every hour
-- and the route writes only for the people whose evening it is and whose day
-- has no review yet (lib/news/review/run.ts). A call with nobody due makes no
-- model call. The schedule lives in the database for the reason 0099 gives:
-- Vercel's free plan allows one cron a day.
--
-- Hourly at one minute past, so the review lands just after 8pm in every
-- zone on the hour, and clear of the morning brief at five past.
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
      'pg_cron/pg_net not available here -- skipping the evening review schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'news-review-hourly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'news-review-hourly',
      '1 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/news-review',
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
