-- The clock that writes the weekly review (plan #1232).
--
-- Every Sunday at 9am New York time Dash writes up the week just gone into
-- core.week_reviews (0126). 9am in New York is 13:00 UTC under daylight
-- saving and 14:00 UTC outside it, and pg_cron reads its schedule in UTC, so
-- the job fires every hour on Sundays (UTC) and the route decides: it writes
-- only when it is Sunday and past 9am in New York, and only for people with
-- no review for the week yet (lib/week-review/review.ts, reviewWeekDue). A
-- call that fails is tried again the next hour; a call that finds the row
-- does nothing and spends nothing.
--
-- The clock is pg_cron and pg_net, as for the observations in 0111 and the
-- morning brief in 0113, because Vercel's free plan allows one cron a day.
-- The origin and the secret come from Supabase Vault under the names 0078
-- already requires, app_origin and cron_secret; nothing new has to be set.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the week review schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'week-review-sunday'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'week-review-sunday',
      '11 * * * 0',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/week-review',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 175000
        )
      $job$
    )
  $schedule$;
end;
$$;
