-- The morning brief and the clock that writes it (plan #1123).
--
-- Each morning Dash writes a short account of the person's day: what is
-- booked today with its time, what is overdue or due, what closes this week,
-- the step their goals wait on, one news story and the Learn question. The
-- facts come from the agenda, the goals home, News and Learn
-- (lib/day-brief/facts.ts); Haiku turns them into three or four sentences, and
-- a day with nothing on is one line. One row per person per day, and the home
-- page shows today's.
--
-- Columns
--
--   day    the calendar day the brief is for, in the person's own zone
--   body   the brief as the home page shows it
--   facts  the lines it was written from, as [{kind, text}], so what a
--          brief said can be checked against what it was given
--   model  the model that wrote it; null for the one-line quiet day and for
--          the plain brief written when there was no model to ask
--
-- Derived, so not a source for Goals (lib/core/sources.ts). The run writes
-- with the service role; the person may only read their own rows.
--
-- The clock is pg_cron and pg_net, as for the observations in 0111, because
-- Vercel's free plan allows one cron a day. Every hour at five past: six in
-- the morning falls in a different UTC hour for each zone, so the route
-- writes for whoever it is six to eleven in the morning for and who has no
-- brief for the day yet, and does nothing for everyone else. The origin and
-- the secret come from Supabase Vault under the names 0078 already requires,
-- app_origin and cron_secret; nothing new has to be set.

set search_path = core, public, extensions;

create table if not exists core.day_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  body text not null,
  facts jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  constraint day_briefs_body_ck check (btrim(body) <> '' and length(body) <= 1000),
  constraint day_briefs_facts_ck check (jsonb_typeof(facts) = 'array')
);

-- One brief a day, and what the home page reads by.
create unique index if not exists day_briefs_user_day_uq
  on core.day_briefs (user_id, day);

alter table core.day_briefs enable row level security;

drop policy if exists day_briefs_select on core.day_briefs;
create policy day_briefs_select on core.day_briefs for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.day_briefs from public, anon, authenticated;
grant select on core.day_briefs to authenticated;
grant select, insert, update, delete on core.day_briefs to service_role;

comment on table core.day_briefs is
  'The morning brief of each day, written by Dash from the agenda, goals, news and Learn (plan #1123).';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the day brief schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'day-brief-hourly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'day-brief-hourly',
      '5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/day-brief',
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
