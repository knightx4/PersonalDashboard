-- The year in review, and the clock that writes last year's (plan #1121).
--
-- A page per year says what the year held, read from core.timeline (goals
-- migration 0053): what was bought and spent, where the job search went,
-- what was learned and written, which goals moved, and what was noticed
-- across the year. The totals are counted from the timeline and Sonnet
-- writes the paragraphs around them. Both are stored here, one row per
-- person and year, so opening the page does not call the model.
--
-- Columns
--
--   year        the calendar year, on the person's own calendar
--   timezone    the zone the year's edges were read in
--   through     the instant the events were read up to: the moment it was
--               written for the current year, the year's end for one that
--               has ended
--   complete    whether `through` was the year's end. A complete review is
--               never rewritten; one written while the year was still going
--               is replaced whenever the person asks, and once more by the
--               clock below after the year ends.
--   events      how many timeline events the year held when it was written
--   totals      what the page shows as numbers: counts per kind, spend per
--               currency, each month's counts, the shops and goals
--               (lib/timeline/year-review.ts, YearTotals)
--   paragraphs  what Dash wrote, as [{topic, text, evidence}]: evidence is
--               the timeline rows behind the paragraph as `schema.table:id`,
--               as in core.observations. Empty when the year held too little
--               to write about.
--   model       the model that wrote the paragraphs, null when none did
--
-- The person reads their own rows. Writing one is a press on the page, which
-- runs under their session, so they may insert and update their own rows;
-- the trigger below is what keeps a complete review as it was written. The
-- yearly clock writes with the service role.
--
-- The clock is pg_cron and pg_net, as for the observations in 0111. At 15:23
-- UTC on 2 January the year has ended everywhere, so the run writes the year
-- just gone for everyone with events in it whose review is missing or was
-- written before the year ended. The origin and the secret come from
-- Supabase Vault under the names 0078 already requires, app_origin and
-- cron_secret; nothing new has to be set.

set search_path = core, public, extensions;

create table if not exists core.year_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  year integer not null,
  timezone text not null,
  through timestamptz not null,
  complete boolean not null default false,
  events integer not null default 0,
  totals jsonb not null,
  paragraphs jsonb not null default '[]'::jsonb,
  model text,
  written_at timestamptz not null default now(),
  constraint year_reviews_year_ck check (year between 2000 and 2200),
  constraint year_reviews_events_ck check (events >= 0),
  constraint year_reviews_totals_ck check (jsonb_typeof(totals) = 'object'),
  constraint year_reviews_paragraphs_ck check (jsonb_typeof(paragraphs) = 'array'),
  constraint year_reviews_model_ck check (model is not null or paragraphs = '[]'::jsonb)
);

create unique index if not exists year_reviews_year_uq
  on core.year_reviews (user_id, year);

-- A review written after its year ended is final.
create or replace function core.year_reviews_keep_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.complete then
    raise exception 'The review of % was written after the year ended and is kept as it is.', old.year
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists year_reviews_keep_complete on core.year_reviews;
create trigger year_reviews_keep_complete
  before update on core.year_reviews
  for each row execute function core.year_reviews_keep_complete();

alter table core.year_reviews enable row level security;

drop policy if exists year_reviews_select on core.year_reviews;
create policy year_reviews_select on core.year_reviews for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists year_reviews_insert on core.year_reviews;
create policy year_reviews_insert on core.year_reviews for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists year_reviews_update on core.year_reviews;
create policy year_reviews_update on core.year_reviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on core.year_reviews from public, anon, authenticated;
grant select, insert, update on core.year_reviews to authenticated;
grant select, insert, update, delete on core.year_reviews to service_role;

comment on table core.year_reviews is
  'The year in review: the year''s totals from core.timeline and the paragraphs Dash wrote around them, each citing its rows (plan #1121).';

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the year review schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'year-review-yearly'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'year-review-yearly',
      '23 15 2 1 *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/year-review',
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
