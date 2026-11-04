-- ===========================================================================
-- A goal's dashboard: its own arrangement of tiles (plan #2778.1).
--
-- Feature #2778 opens every goal on a Dashboard tab made of tiles that fit
-- that goal: a balance line and an application tracker for the loans, room
-- cards and a buy list for the apartment. The arrangement is kept on the goal
-- itself:
--
--   items.dashboard   an ordered jsonb array of tiles, each an object whose
--                     "type" is one of the tile types below and whose other
--                     keys name the list, metric or steps it reads. Null
--                     until a layout is saved, and only ever set on a goal.
--
-- A column rather than a table, so the sources catalogue does not grow and
-- the layout travels with the goal's history like every other column.
--
-- lib/goals/dashboard.ts is the full check: it names a tile whose list is not
-- on the goal or whose field the list does not have, and every writer (the
-- app, Ask Dash, the connector) saves through it. The database checks only
-- what holds whatever the goal's lists say: the layout is an array of at most
-- 24 objects, and each tile's type is one of the set. A layout that fails is
-- refused with the tile's position and what is wrong with it.
--
-- The set is kept in step with TILE_TYPES in lib/goals/dashboard.ts, which
-- lib/goals/dashboard.test.ts reads from this file.
--
-- No existing row is changed by this file.
-- ===========================================================================

alter table goals.items add column dashboard jsonb;

comment on column goals.items.dashboard is
  'The goal''s dashboard tiles in order, checked by lib/goals/dashboard.ts and goals.dashboard_problem (goals 0091). Null until a layout is saved; goals only.';

-- ---------------------------------------------------------------------------
-- What is wrong with a layout, or null when it holds.
-- ---------------------------------------------------------------------------
create or replace function goals.dashboard_problem(layout jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  tile jsonb;
  kind text;
  n integer := 0;
begin
  if layout is null then
    return null;
  end if;
  if jsonb_typeof(layout) <> 'array' then
    return 'the layout is not a list of tiles';
  end if;
  if jsonb_array_length(layout) > 24 then
    return format('the layout has %s tiles, and a goal holds at most 24', jsonb_array_length(layout));
  end if;
  for tile in select value from jsonb_array_elements(layout) loop
    n := n + 1;
    if jsonb_typeof(tile) <> 'object' then
      return format('tile %s is not a tile', n);
    end if;
    if jsonb_typeof(tile -> 'type') is distinct from 'string' then
      return format('tile %s has no type', n);
    end if;
    kind := tile ->> 'type';
    if kind not in ('number', 'countdown', 'chart', 'table', 'rooms', 'slots', 'tracker', 'grid') then
      return format('tile %s has type "%s", which is not a tile type', n, left(kind, 40));
    end if;
  end loop;
  return null;
end;
$$;

grant execute on function goals.dashboard_problem(jsonb) to authenticated, service_role;

comment on function goals.dashboard_problem(jsonb) is
  'What is wrong with a goal dashboard layout, naming the tile by its position, or null when it holds (goals 0091).';

-- ---------------------------------------------------------------------------
-- Refuse a layout on anything but a goal, and a layout that fails the check.
-- ---------------------------------------------------------------------------
create or replace function goals.items_dashboard_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  problem text;
begin
  if new.dashboard is null then
    return new;
  end if;
  if new.level <> 'goal' then
    raise exception 'dashboard: only a goal has a dashboard'
      using errcode = 'check_violation', constraint = 'items_dashboard_goal';
  end if;
  problem := goals.dashboard_problem(new.dashboard);
  if problem is not null then
    raise exception 'dashboard: %', problem
      using errcode = 'check_violation', constraint = 'items_dashboard_layout';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_dashboard_check() from public, anon, authenticated;

create trigger items_dashboard_check before insert or update of dashboard, level on goals.items
  for each row execute function goals.items_dashboard_check();

notify pgrst, 'reload schema';
