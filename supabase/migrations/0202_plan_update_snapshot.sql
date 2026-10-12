-- A snapshot of the feature's steps saved with each update (plan #1832).
--
-- An update already keeps how many steps were done before and after. The
-- snapshot adds what those counts cannot say: the total, how many are
-- blocked, and which steps were open, so the next update can tell which
-- steps were added or taken out since. It holds counts and ids only, never
-- step text, so it stays small and nothing the person wrote is copied.
--
-- Shape (lib/progress-snapshot.ts, the one place that reads it):
--   { "v": 1, "open": n, "done": n, "total": n, "blocked": n,
--     "openIds": ["<step id>", ...], "dueOn": null }
-- Steps are counted as `updateCounts` counts them: beneath the feature,
-- built work only, dropped steps left out. `dueOn` is always null here; plan
-- rows have no due date, and the key is there so a goal's snapshot and a
-- feature's read the same.
--
-- A trigger fills the snapshot when the insert does not give one, so
-- scripts/plan.ts `update` and the offline SQL in the plan skill both write
-- it without changing what they send. Rows from before are left null.

set search_path = public, extensions;

create or replace function plan_feature_snapshot(p_feature_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
as $$
  with recursive beneath as (
    select id, kind, status from plan_items
    where parent_id = p_feature_id and user_id = p_user_id
    union all
    select p.id, p.kind, p.status from plan_items p
    join beneath b on p.parent_id = b.id
    where p.user_id = p_user_id
  ), counted as (
    select * from beneath where kind = 'build' and status <> 'dropped'
  )
  select jsonb_build_object(
    'v', 1,
    'open', count(*) filter (where status <> 'done'),
    'done', count(*) filter (where status = 'done'),
    'total', count(*),
    'blocked', count(*) filter (where status = 'blocked'),
    'openIds', coalesce(jsonb_agg(id order by id) filter (where status <> 'done'), '[]'::jsonb),
    'dueOn', null
  )
  from counted;
$$;

alter table plan_updates add column snapshot jsonb;

alter table plan_updates add constraint plan_updates_snapshot_ck
  check (snapshot is null or jsonb_typeof(snapshot) = 'object');

create or replace function plan_updates_fill_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.snapshot is null then
    new.snapshot := plan_feature_snapshot(new.feature_id, new.user_id);
  end if;
  return new;
end;
$$;

create trigger plan_updates_snapshot before insert on plan_updates
  for each row execute function plan_updates_fill_snapshot();

comment on column plan_updates.snapshot is
  'The feature''s steps when the update was written (plan #1832): open, done, total, blocked, the ids of open steps. Counts and ids only. Null on updates from before.';

notify pgrst, 'reload schema';
