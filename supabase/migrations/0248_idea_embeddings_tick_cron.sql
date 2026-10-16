-- The clock behind the idea embedding sweep (plan #2147.1).
--
-- `/api/cron/idea-embeddings` embeds every idea in learn.concepts that has no
-- voyage-4-lite vector, continuing for about four minutes or until none is
-- due. Ideas saved while the embedding call failed were only caught by the
-- daily cron, which shares its five minutes with other stages and fell behind
-- (about 150 of 384 had none). Every ten minutes means an idea has its vector
-- within the tick; a call with nothing due costs one indexed select.
--
-- Same shape as 0094: pg_cron for the schedule, pg_net for the POST, origin
-- and secret read from Vault (app_origin, cron_secret) at fire time, and
-- unschedule-then-schedule by name so applying it twice leaves one job.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the idea embeddings schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'idea-embeddings-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'idea-embeddings-tick',
      '*/10 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/idea-embeddings',
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
