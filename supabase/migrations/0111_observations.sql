-- The weekly observations and the clock that writes them (plan #1119).
--
-- Once a week Dash reads the last twelve weeks of a person's timeline
-- (core.timeline, goals migration 0053) and writes up to three things it
-- noticed that cross two or more modules: that more was spent in the weeks
-- after a rejection, that no notes were written in the weeks with interviews.
-- Each one names a number and the rows behind it. They are stored here, one
-- row per observation, and the home page shows the week's (plan #1120).
--
-- Columns
--
--   week       the Monday (UTC) of the week the observation was written
--              for. The run reads the twelve whole weeks before it.
--   position   1 to 3, the order the run gave them in
--   sentence   what was noticed, addressed to the person, with a number in it
--   evidence   the timeline rows behind it, as `schema.table:id`: the
--              source_table and source_id of core.timeline, joined by a
--              colon (lib/timeline/timeline.ts, eventRef). An array, since
--              the rows sit in six schemas and there is nothing to join on
--              but the ref; a reader drops any that have since gone.
--   modules    the modules those rows come from, always two or more
--   verdict    null until the person says; 'not_useful' hides it for good
--              and is sent to the next three months of runs as something to
--              leave alone; 'useful' is kept for later runs to lean on
--   verdict_at when the verdict was given
--   model      the model that wrote it
--
-- The run writes with the service role. The person reads their own rows and
-- may change only the verdict, which is all the page needs; the column grant
-- below is what holds them to it.
--
-- The clock is pg_cron and pg_net, as for the note connections in 0107,
-- because Vercel's free plan allows one cron a day. Mondays at 14:07 UTC,
-- after the daily vault sync (12:33) and the note connections (13:37), so
-- the week's notes are in. The origin and the secret come from Supabase
-- Vault under the names 0078 already requires, app_origin and cron_secret;
-- nothing new has to be set. A second call in the same week finds that
-- week's rows and does nothing.

set search_path = core, public, extensions;

create table if not exists core.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week date not null,
  position smallint not null,
  sentence text not null,
  evidence text[] not null,
  modules text[] not null,
  verdict text,
  verdict_at timestamptz,
  model text,
  created_at timestamptz not null default now(),
  constraint observations_week_monday_ck check (extract(isodow from week) = 1),
  constraint observations_position_ck check (position between 1 and 3),
  constraint observations_sentence_ck check (btrim(sentence) <> '' and length(sentence) <= 400),
  constraint observations_evidence_ck check (cardinality(evidence) >= 2),
  constraint observations_modules_ck check (cardinality(modules) >= 2),
  constraint observations_verdict_ck check (verdict in ('useful', 'not_useful')),
  constraint observations_verdict_at_ck check ((verdict is null) = (verdict_at is null))
);

-- One row per place in a week, and what the home page reads by.
create unique index if not exists observations_week_uq
  on core.observations (user_id, week, position);

-- What a run reads back as things to leave alone.
create index if not exists observations_not_useful_idx
  on core.observations (user_id, verdict_at)
  where verdict = 'not_useful';

alter table core.observations enable row level security;

drop policy if exists observations_select on core.observations;
create policy observations_select on core.observations for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists observations_update on core.observations;
create policy observations_update on core.observations for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on core.observations from public, anon, authenticated;
grant select on core.observations to authenticated;
grant update (verdict, verdict_at) on core.observations to authenticated;
grant select, insert, update, delete on core.observations to service_role;

comment on table core.observations is
  'Up to three things Dash noticed each week across the modules, each with a number and the core.timeline rows behind it (plan #1119).';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the observations schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'observations-weekly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'observations-weekly',
      '7 14 * * 1',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/observations',
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
