-- The weekly clock behind the spec audit (plan #1524).
--
-- `/api/cron/spec-audit` fires the spec audit routine once a week
-- (inngest/dev/spec-audit.ts), which follows .claude/skills/spec-audit and
-- writes spec_findings rows under one audit_id. Two additions:
--
--   plan_runs.job 'audit'  the fire, recorded like the vision review's, with
--                          no step. It is what stops a second fire in the
--                          same week.
--   spec-audit-weekly      a pg_cron job, Mondays at 14:47 UTC.
--
-- The schedule lives in the database for the reason 0099 gives: Vercel's free
-- plan allows one cron a day. The origin and the secret come from Supabase
-- Vault at fire time, under the names 0078 already requires: app_origin and
-- cron_secret. Nothing new has to be set in the database.
--
-- Unschedule-then-schedule by name, so applying this twice leaves one job, and
-- guarded on the extensions so the local test database, which has neither,
-- still resets. The job list is 0177's with 'audit' added.

alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
          'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts', 'spec_change', 'overhaul',
          'audit')
);

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the spec audit schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'spec-audit-weekly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'spec-audit-weekly',
      '47 14 * * 1',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/spec-audit',
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
