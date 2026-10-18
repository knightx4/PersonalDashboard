-- Deep insights about the person, their evidence and the person's verdicts
-- (plan #2413.1, under #2413).
--
-- Dash writes insights about the person on the Insights tab of You: each one
-- goes at least two layers deeper than what they wrote, with every claim
-- linked to the row or note it came from. The person marks each one right,
-- not quite or wrong, and the next run reads those marks.
--
-- 1. you.insight_runs
--
-- One row per run, modelled on job_search.company_research: the weekly run
-- and the Look again button each queue one, and the session that does the
-- reading moves it to running and then ready or failed. summary is the run's
-- one-paragraph account of what it looked at; run_url is the session.
-- One run at a time per person.
--
-- 2. you.insights
--
--   kind        a short lowercase word naming the sort of insight, such as
--               pattern or tension; the method (#2413.4) sets the words
--   claim       the insight in one or two sentences
--   layers      [ { depth: saw | deeper | further, text } ], in order: what
--               they wrote, what lies under it, and what lies under that
--   receipts    [ { source, row_id, quote, link } ]: source is a table such
--               as you.places or a vault path; quote is the words or number
--               relied on; link opens it in the app
--   confidence  high, medium or hunch
--   live_ref    the deadline or row the insight is tied to, when one is
--   status      shown, retired (taken down) or superseded (by superseded_by)
--
-- 3. you.insight_verdicts
--
-- The person's mark on one insight: right, not_quite or wrong, with an
-- optional note. One per insight; marking it again replaces the mark and
-- moves decided_at.
--
-- Every row names its owner, and a child can only point at a parent of the
-- same owner (the composite foreign keys).

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Runs.
-- ---------------------------------------------------------------------------

create table you.insight_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued',
  summary text check (summary is null or char_length(summary) <= 4000),
  error text check (error is null or char_length(error) <= 2000),
  run_url text check (run_url is null or char_length(run_url) <= 500),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint insight_runs_status_ck check (status in ('queued', 'running', 'ready', 'failed')),
  constraint insight_runs_id_user_id_key unique (id, user_id)
);

comment on table you.insight_runs is
  'Each run that wrote insights about the person, weekly or from Look again, with its state and summary (plan #2413.1).';

create index insight_runs_user_idx on you.insight_runs (user_id, requested_at desc);

-- One run at a time, so a second press does not start a second session.
create unique index insight_runs_one_running
  on you.insight_runs (user_id) where status in ('queued', 'running');

create trigger insight_runs_touch_updated_at
  before update on you.insight_runs
  for each row execute function you.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Insights.
-- ---------------------------------------------------------------------------

create table you.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid,
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),
  claim text not null check (btrim(claim) <> '' and char_length(claim) <= 1000),
  layers jsonb not null default '[]'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  confidence text not null,
  live_ref text check (live_ref is null or char_length(live_ref) <= 300),
  status text not null default 'shown',
  superseded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint insights_layers_ck check (jsonb_typeof(layers) = 'array'),
  constraint insights_receipts_ck check (jsonb_typeof(receipts) = 'array'),
  constraint insights_confidence_ck check (confidence in ('high', 'medium', 'hunch')),
  constraint insights_status_ck check (status in ('shown', 'retired', 'superseded')),
  constraint insights_superseded_by_ck check (superseded_by is null or status = 'superseded'),
  constraint insights_not_superseded_by_itself_ck check (superseded_by is null or superseded_by <> id),
  constraint insights_id_user_id_key unique (id, user_id),

  foreign key (run_id, user_id)
    references you.insight_runs (id, user_id) on delete set null (run_id),
  foreign key (superseded_by, user_id)
    references you.insights (id, user_id) on delete set null (superseded_by)
);

comment on table you.insights is
  'Insights Dash wrote about the person: the claim, its layers, the evidence for it and whether it is still shown (plan #2413.1).';

create index insights_user_idx on you.insights (user_id, status, created_at desc);
create index insights_run_idx on you.insights (run_id) where run_id is not null;
create index insights_superseded_by_idx on you.insights (superseded_by) where superseded_by is not null;

create trigger insights_touch_updated_at
  before update on you.insights
  for each row execute function you.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Verdicts.
-- ---------------------------------------------------------------------------

create table you.insight_verdicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  insight_id uuid not null,
  verdict text not null check (verdict in ('right', 'not_quite', 'wrong')),
  note text check (note is null or char_length(note) <= 2000),
  decided_at timestamptz not null default now(),

  constraint insight_verdicts_insight_id_key unique (insight_id),

  foreign key (insight_id, user_id)
    references you.insights (id, user_id) on delete cascade
);

comment on table you.insight_verdicts is
  'The person''s mark on an insight Dash wrote: right, not quite or wrong, with an optional note (plan #2413.1).';

create index insight_verdicts_user_idx on you.insight_verdicts (user_id);

-- ---------------------------------------------------------------------------
-- 4. Row level security: each person's rows are theirs alone.
-- ---------------------------------------------------------------------------

alter table you.insight_runs enable row level security;
alter table you.insights enable row level security;
alter table you.insight_verdicts enable row level security;

create policy insight_runs_all on you.insight_runs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy insights_all on you.insights for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy insight_verdicts_all on you.insight_verdicts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.insight_runs, you.insights, you.insight_verdicts from anon, authenticated;
grant select, insert, update, delete
  on you.insight_runs, you.insights, you.insight_verdicts
  to authenticated, service_role;

notify pgrst, 'reload schema';
