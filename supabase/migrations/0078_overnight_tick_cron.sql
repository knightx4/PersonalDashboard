-- The clock behind the overnight runner, bought for nothing.
--
-- `/api/cron/overnight` is one tick: it looks at the account's
-- `plan_overnight_runs` row, and if the last feature it fired has finished it
-- fires the next one. That is only a runner if something presses it every few
-- minutes all night. Vercel's free plan allows one cron a day, which would fire
-- one feature a night, so the clock cannot live there. `pg_cron` and `pg_net`
-- are both on the Supabase project already and cost nothing, so the clock lives
-- in the database: `pg_cron` for the schedule, `pg_net` for the outbound POST.
--
-- Every four minutes, not every minute. The tick is not re-entrant-safe by a
-- lock -- it is safe only by liveness, reading `last_fired_at` and the run's
-- state to decide whether the last feature is still going. Two ticks a minute
-- apart could both read a session as ended before either writes, and fire twice
-- against one budget. Four minutes is comfortably longer than a fire takes, and
-- a tick with nothing running costs one indexed select against
-- `plan_overnight_runs_running_idx` -- about as cheap as a query gets.
--
-- The schedule is UTC. `pg_cron` evaluates its cron expression in the database
-- server's timezone, and Supabase runs its databases in UTC. `*/4 * * * *` does
-- not care about the offset, but a later change to a wall-clock schedule ("only
-- between 10pm and 7am") would, and it would be 10pm UTC, not 10pm at home.
--
-- WHAT A HUMAN MUST DO ONCE, BY HAND, OR THIS JOB POSTS NOWHERE
-- -------------------------------------------------------------------------
-- The origin to post to and the secret to post with are deployment facts, not
-- schema: they differ between this project and any other copy of it, and the
-- secret must never be committed. So the job reads both from Supabase Vault at
-- fire time, and two secrets have to exist there before it can work. In the
-- Supabase dashboard, Project Settings -> Vault -> Add new secret, twice:
--
--   Name:   app_origin
--   Secret: the deployed origin of this app, scheme and host only, no trailing
--           slash and no path -- e.g. https://your-app.vercel.app
--
--   Name:   cron_secret
--   Secret: the exact value of the CRON_SECRET environment variable in Vercel
--           (or of TOKEN_ENCRYPTION_KEY if CRON_SECRET is not set, since that
--           is what `authorizeCron` falls back to). The route answers
--           401 {"error":"unauthorized"} to anything else, which is what stops
--           a passer-by firing Claude sessions on this account.
--
-- The names above are exact; the job looks them up by name. This migration does
-- not invent values for them, and cannot: it has no way to know either one. If
-- they are missing the migration still applies and the job is still scheduled,
-- it just posts to nowhere until they are added -- see the warning this raises
-- at the bottom. Adding them later needs no second migration. This is also
-- written down in docs/SETUP.md under "Cron".
--
-- Safe to run twice, which a table is for free and this is not. `create
-- extension` is guarded by `if not exists`; `cron.schedule` is not -- calling it
-- again with the same name replaces the job in pg_cron 1.6, but older versions
-- and any rename would leave two jobs ticking against one budget, so the job is
-- unscheduled by name first and that unschedule is written as a select over
-- `cron.job` (no rows, no work) rather than `cron.unschedule('name')`, which
-- raises when the job is not there.
--
-- Guarded on the extensions being available at all, because the local test
-- database that scripts/db-reset.sh builds is a plain Postgres 16 with neither
-- extension and no Vault. There is no clock to install there and nothing for it
-- to post to, so this migration notices and says so instead of failing the
-- reset, which would take every RLS test down with it.

set search_path = public, extensions;

do $$
declare
  have_vault boolean;
  have_secrets boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the overnight tick schedule. Expected on the local test database; on Supabase it means the extensions were removed from the project.';
    return;
  end if;

  -- pg_cron insists on its own schema (`cron`) and pg_net on its own (`net`),
  -- so neither takes a `with schema` clause the way 0001 gives pgcrypto one.
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  -- The job runs as the role that scheduled it -- the migration runner, i.e.
  -- postgres -- which is the role that may read vault.decrypted_secrets. Said
  -- out loud because a project that has never had pg_cron before starts
  -- without it.
  execute 'grant usage on schema cron to postgres';

  -- Unschedule-then-schedule, so applying this migration twice leaves one job.
  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'overnight-tick'
  $unschedule$;

  -- The body is a string to pg_cron and is only parsed when it fires, so the
  -- two Vault lookups happen every four minutes rather than once here: rotate
  -- the secret or move the deployment and the next tick picks it up with no
  -- migration.
  --
  -- POST with an empty body on purpose. The route exports GET and POST
  -- identically and ignores the body -- everything the tick needs is in the
  -- row -- and `net.http_post` is the pg_net call that takes headers most
  -- naturally.
  --
  -- pg_net is fire-and-forget: it hands the request to a background worker and
  -- returns a request id, so the four-minute schedule is never held open by a
  -- tick that takes a while. The reply lands in `net._http_response` for a few
  -- hours, which is where to look when the tick appears to do nothing. The
  -- timeout is 60s to match the route's own `maxDuration`; a shorter one would
  -- throw the reply away while the fire it started carried on regardless,
  -- which is the confusing half of a failure rather than a real one.
  execute $schedule$
    select cron.schedule(
      'overnight-tick',
      '*/4 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/overnight',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        )
      $job$
    )
  $schedule$;

  -- Say plainly, at apply time, whether the two secrets are there. A job that
  -- posts to nowhere is otherwise silent: pg_cron records a successful run
  -- because the statement succeeded, and a null url just means pg_net was
  -- handed nothing.
  select exists (
    select 1 from pg_namespace where nspname = 'vault'
  ) into have_vault;

  if not have_vault then
    raise warning
      'Vault is not on this project: the overnight tick is scheduled but will post nowhere until vault.decrypted_secrets holds app_origin and cron_secret.';
    return;
  end if;

  execute $check$
    select count(*) = 2 from vault.decrypted_secrets where name in ('app_origin', 'cron_secret')
  $check$ into have_secrets;

  if not have_secrets then
    raise warning
      'The overnight tick is scheduled but both Vault secrets are not set yet. Add them in Project Settings -> Vault: app_origin (the deployed origin, e.g. https://your-app.vercel.app, no trailing slash) and cron_secret (the value of CRON_SECRET in Vercel). Until then every tick posts to nowhere.';
  end if;
end;
$$;
