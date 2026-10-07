-- Dash's update on a feature, with a health (plan #1666).
--
-- At the end of a build or re-shape run on a feature, Dash writes a short
-- update on it: a health (on track, at risk or blocked), two or three
-- sentences on what moved, and how many of the feature's steps were done
-- before the run and after it. The feature's page shows the latest one at
-- the top of its Overview tab, and the older ones on its Activity tab.
--
-- Rows are written by sessions, through scripts/plan.ts `update` with the
-- service role or through the connector, and never from a press on a page,
-- so a signed-in account can only read its own.
--
-- `feature_id` is the plan row the update is about, and the update goes with
-- it when the feature is deleted. `run_id` is the run that wrote it, where
-- one was recorded in plan_runs; a session run from a terminal has none and
-- says which session it was in `session` instead. The step counts cover the
-- steps and substeps beneath the feature, decisions and dropped steps left
-- out: `steps_done_before` is the count when the last update was written (or
-- a day ago, for the first), `steps_done_after` and `steps_total` the count
-- as this one is written.

set search_path = public, extensions;

create table if not exists plan_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature_id uuid not null references plan_items (id) on delete cascade,
  health text not null,
  body text not null,
  steps_done_before integer not null,
  steps_done_after integer not null,
  steps_total integer not null,
  run_id uuid references plan_runs (id) on delete set null,
  session text,
  created_at timestamptz not null default now(),
  constraint plan_updates_health_ck check (health in ('on_track', 'at_risk', 'blocked')),
  constraint plan_updates_body_ck check (length(btrim(body)) > 0 and length(body) <= 1200),
  constraint plan_updates_counts_ck check (
    steps_done_before >= 0 and steps_done_after >= 0 and steps_done_after <= steps_total
  ),
  constraint plan_updates_session_ck check (session is null or length(session) <= 200)
);

-- The page reads a feature's updates newest first.
create index if not exists plan_updates_feature_idx
  on plan_updates (user_id, feature_id, created_at desc);

alter table plan_updates enable row level security;

create policy plan_updates_select on plan_updates for select to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud for the reasons 0050 gives.
revoke all on plan_updates from anon;
grant select on plan_updates to authenticated;
