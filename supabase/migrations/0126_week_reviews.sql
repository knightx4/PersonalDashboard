-- The weekly review, one row per person and week (plan #1230).
--
-- Every Sunday Dash writes one page about the week just gone, Sunday to
-- Saturday: three to five observations with numbers, each compared with the
-- week before and tied to a goal, and one thing to change next week. The app
-- counts the numbers from rows it already holds (plan #1231) and the model
-- only chooses and words them (plan #1232). Each review is kept here so the
-- next one compares against the numbers that were actually counted and says
-- whether last week's change happened. The Week page reads it (plan #1233)
-- and the push notification marks it sent (plan #1234).
--
-- Columns
--
--   week          the Sunday that starts the week reviewed, on the person's
--                 calendar
--   timezone      the zone the week's edges were read in
--   facts         the counted numbers per module for the week, as the facts
--                 step returns them. Stored so the next review compares
--                 against what was counted then, not a recount.
--   observations  what Dash wrote, as [{text, goal_id, evidence}]: goal_id is
--                 the goals.goals row it is tied to, or null; evidence is the
--                 rows behind it as `schema.table:id`, as in core.observations
--   change        the one thing to change next week
--   change_kept   whether the previous week's change happened: null when
--                 there was no previous review or it cannot be told
--   source        'model' when a model wrote it, 'plain' when the model was
--                 unavailable and the app wrote a plain version from the facts
--   model         the model that wrote it, set exactly when source is 'model'
--   notified_at   when the push notification about it was sent, null before
--
-- One row per person and week, so a second run in the same week finds the
-- row and stores nothing. The run writes with the service role; the person
-- reads their own rows and writes none.

set search_path = core, public, extensions;

create table if not exists core.week_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week date not null,
  timezone text not null default 'America/New_York',
  facts jsonb not null,
  observations jsonb not null default '[]'::jsonb,
  change text,
  change_kept boolean,
  source text not null,
  model text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint week_reviews_week_sunday_ck check (extract(dow from week) = 0),
  constraint week_reviews_facts_ck check (jsonb_typeof(facts) = 'object'),
  constraint week_reviews_observations_ck check (jsonb_typeof(observations) = 'array'),
  constraint week_reviews_change_ck check (change is null or (btrim(change) <> '' and length(change) <= 600)),
  constraint week_reviews_source_ck check (source in ('model', 'plain')),
  constraint week_reviews_model_ck check ((source = 'model') = (model is not null))
);

-- One review per person and week, and what the Week page reads by.
create unique index if not exists week_reviews_week_uq
  on core.week_reviews (user_id, week);

alter table core.week_reviews enable row level security;

drop policy if exists week_reviews_select on core.week_reviews;
create policy week_reviews_select on core.week_reviews for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.week_reviews from public, anon, authenticated;
grant select on core.week_reviews to authenticated;
grant select, insert, update, delete on core.week_reviews to service_role;

comment on table core.week_reviews is
  'The weekly review: the week''s counted numbers, what Dash wrote about them tied to goals, and the one change for next week (plan #1230).';
