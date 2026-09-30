-- The clock that finishes searches carried on as Message Batches.
--
-- A Recommended roles or People to meet search that needs more time than a
-- request allows goes on as a Message Batch (lib/jobs/suggest/search-batch.ts,
-- job_search 0041). `/api/cron/job-search-batches` collects the batches that
-- have ended, stores what they found and closes their runs
-- (runSearchBatches in inngest/jobs/suggestions.ts).
--
-- Every ten minutes: a batch usually ends within the hour, and a result
-- should not then wait long to reach the page. A call that finds nothing
-- queued costs one read. The origin and the secret come from Supabase Vault
-- at fire time, as 0117's do.
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
      'pg_cron/pg_net not available here -- skipping the job search batches schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'job-search-batches'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'job-search-batches',
      '*/10 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/job-search-batches',
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
