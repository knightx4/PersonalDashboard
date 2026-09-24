-- ===========================================================================
-- goals.item_goals -- extra goals a step counts towards (plan #925).
--
-- A step belongs to one goal through its parent chain. One action can serve
-- several goals, though: a volunteering shift counts towards the city goal
-- and the friends goal (docs/GOALS-SPEC.md, "Where things live"). A row here
-- says a step also counts towards a second goal, and that goal's full tree
-- shows it beside its own steps.
--
-- Nothing is deleted. Unlinking sets archived_at, which the history trigger
-- records as `archive`; linking the same pair again brings that row back, so
-- one step and one goal have at most one live link and one row between them.
-- ===========================================================================

create table goals.item_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  goal_id uuid not null,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint item_goals_id_user_key unique (id, user_id),
  constraint item_goals_pair_key unique (item_id, goal_id),

  -- No action, like items' own parent key: a step or goal that still has a
  -- link cannot be hard-deleted by mistake. The account going still clears
  -- both, because the check runs after the cascade.
  constraint item_goals_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id),
  constraint item_goals_goal_fk foreign key (goal_id, user_id)
    references goals.items (id, user_id),
  constraint item_goals_not_self_ck check (item_id <> goal_id)
);

create index item_goals_goal_idx on goals.item_goals (goal_id) where archived_at is null;
create index item_goals_item_idx on goals.item_goals (item_id) where archived_at is null;

-- The shape a check constraint cannot see, because it spans rows: the link
-- runs from a step to a goal, and the goal is not the one the step already
-- sits under. Checked on insert and whenever either end changes.
create or replace function goals.item_goals_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_level text;
  goal_level text;
  own_goal uuid;
begin
  select i.level into item_level from goals.items i where i.id = new.item_id;
  if item_level is distinct from 'step' then
    raise exception 'item_goals: % is not a step', new.item_id
      using errcode = 'check_violation', constraint = 'item_goals_item_is_step';
  end if;

  select g.level into goal_level from goals.items g where g.id = new.goal_id;
  if goal_level is distinct from 'goal' then
    raise exception 'item_goals: % is not a goal', new.goal_id
      using errcode = 'check_violation', constraint = 'item_goals_goal_is_goal';
  end if;

  with recursive up as (
    select i.id, i.parent_id, i.level from goals.items i where i.id = new.item_id
    union all
    select p.id, p.parent_id, p.level from goals.items p join up on p.id = up.parent_id
  )
  select up.id into own_goal from up where up.level = 'goal' limit 1;
  if own_goal = new.goal_id then
    raise exception 'item_goals: the step already sits under that goal'
      using errcode = 'check_violation', constraint = 'item_goals_not_own_goal';
  end if;

  return new;
end;
$$;

revoke all on function goals.item_goals_check() from public, anon, authenticated;

create trigger item_goals_check before insert or update of item_id, goal_id on goals.item_goals
  for each row execute function goals.item_goals_check();

create trigger item_goals_touch_updated_at before update on goals.item_goals
  for each row execute function goals.touch_updated_at();

-- History, like every other table in the schema.
alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'runs', 'captures', 'readings', 'periods', 'suggestions'
  )
);

create trigger item_goals_history after insert or update or delete on goals.item_goals
  for each row execute function goals.record_history();

alter table goals.item_goals enable row level security;

create policy item_goals_all on goals.item_goals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.item_goals from anon, public;
grant select, insert, update, delete on goals.item_goals to authenticated, service_role;

notify pgrst, 'reload schema';
