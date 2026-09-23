-- The clock behind Learn now (docs/LEARN-NOW-SPEC.md, "How cards are made";
-- plan #807).
--
-- `/api/cron/feed-top-up` keeps about twenty ready cards per person: it writes
-- the picked rows in learn.feed_cards into cards, and picks more sections from
-- Wikipedia first when there are not enough picked rows to write. Cards are
-- used up as they are read, so something has to call it again, and Vercel's
-- free plan allows one cron a day. The clock lives in the database, the same
-- way as theme placement's in 0097: `pg_cron` for the schedule and `pg_net`
-- for the POST.
--
-- Hourly, at forty-one minutes past so it does not land with theme placement
-- at seventeen past. When everyone has twenty ready cards a call costs one
-- count per person and no model calls.
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
      'pg_cron/pg_net not available here -- skipping the Learn now top-up schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'feed-top-up-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'feed-top-up-tick',
      '41 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/feed-top-up',
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
