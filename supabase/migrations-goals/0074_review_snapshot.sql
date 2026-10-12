-- ===========================================================================
-- A snapshot of the goal's steps saved with each review (plan #1832).
--
-- A review says how the goal stands today. The snapshot keeps the numbers
-- that reading was based on, so a later page can show what changed between
-- two reviews: steps closed, steps added, a moved due date. Counts, ids and
-- the due date only, never step text.
--
-- Shape (lib/progress-snapshot.ts, the one place that reads it):
--   { "v": 1, "open": n, "done": n, "total": n, "blocked": n,
--     "openIds": ["<step id>", ...], "dueOn": "2026-12-31" | null }
-- Steps are the goal's steps at any depth, proposed and dropped ones left
-- out: `open` is open plus blocked, `blocked` is the blocked ones, `total`
-- is open plus done. `dueOn` is the goal's own due_on.
--
-- A trigger fills it when the insert gives none, so the daily run's
-- insert statements in the goals skill need no change. Rows from before are
-- left null.
-- ===========================================================================

create or replace function goals.goal_snapshot(p_goal_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
as $$
  with recursive beneath as (
    select id, status from goals.items
    where parent_id = p_goal_id and user_id = p_user_id and level = 'step'
    union all
    select i.id, i.status from goals.items i
    join beneath b on i.parent_id = b.id
    where i.user_id = p_user_id and i.level = 'step'
  ), counted as (
    select * from beneath where status in ('open', 'blocked', 'done')
  )
  select jsonb_build_object(
    'v', 1,
    'open', count(*) filter (where status in ('open', 'blocked')),
    'done', count(*) filter (where status = 'done'),
    'total', count(*),
    'blocked', count(*) filter (where status = 'blocked'),
    'openIds', coalesce(
      jsonb_agg(id order by id) filter (where status in ('open', 'blocked')), '[]'::jsonb),
    'dueOn', (select to_char(due_on, 'YYYY-MM-DD') from goals.items
              where id = p_goal_id and user_id = p_user_id)
  )
  from counted;
$$;

alter table goals.reviews add column snapshot jsonb;

alter table goals.reviews add constraint reviews_snapshot_ck
  check (snapshot is null or jsonb_typeof(snapshot) = 'object');

create or replace function goals.reviews_fill_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.snapshot is null then
    new.snapshot := goals.goal_snapshot(new.item_id, new.user_id);
  end if;
  return new;
end;
$$;

create trigger reviews_snapshot before insert on goals.reviews
  for each row execute function goals.reviews_fill_snapshot();

comment on column goals.reviews.snapshot is
  'The goal''s steps and due date when the review was written (plan #1832): open, done, total, blocked, the ids of open steps, dueOn. Counts and ids only. Null on reviews from before.';

notify pgrst, 'reload schema';
