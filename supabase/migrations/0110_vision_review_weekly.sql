-- The weekly clock behind the vision review (plan #1108).
--
-- `/api/cron/vision-review` fires the vision review routine once a week
-- (inngest/dev/vision-review.ts), which follows .claude/skills/vision-review
-- and writes one vision_reviews row per workspace. Two additions:
--
--   plan_runs.job 'vision'  the fire, recorded like the UI review's, with no
--                           step. It is what the Dash tab reads for the last
--                           run and what stops a second fire in the same week.
--   vision-review-weekly    a pg_cron job, Sundays at 14:41 UTC. The first
--                           review ran on Sunday 27 September 2026, so the
--                           weeks start there.
--
-- The schedule lives in the database for the reason 0099 gives: Vercel's free
-- plan allows one cron a day. The origin and the secret come from Supabase
-- Vault at fire time, under the names 0078 already requires: app_origin and
-- cron_secret. Nothing new has to be set in the database.
--
-- Unschedule-then-schedule by name, so applying this twice leaves one job, and
-- guarded on the extensions so the local test database, which has neither,
-- still resets.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision')
);

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the vision review schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'vision-review-weekly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'vision-review-weekly',
      '41 14 * * 0',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/vision-review',
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
