-- Fill `block_kind` when a row becomes blocked, rather than requiring every
-- writer to remember it.
--
-- 0081 added the column and the constraint that a blocked step must carry a
-- kind. `blockPatch` in lib/plan/load.ts fills it for every write the app
-- makes, so the pages and the CLI were fine -- but the constraint is on the
-- table and the table has other writers. `tests/plan-tree.test.ts` sets a
-- status in raw SQL to check the tree, and it failed on main within hours,
-- taking CI red with it. A hand-written fix through the SQL editor would have
-- hit the same wall, at a worse moment.
--
-- So the rule moves to where the constraint is. A row that arrives blocked
-- with no kind gets `outside`, which is the same default `blockPatch` applies
-- and the same value 0081 back-filled the existing rows with: the common case
-- is a step waiting on the person, and `--on-steps` is what says otherwise.
-- Anything that does name a kind keeps it.
--
-- The other half is the release. A step that stops being blocked keeps no
-- kind and no ask -- both describe a block that is over, and a stale ask is
-- the thing Dash would still be showing you tomorrow.
--
-- A trigger rather than a column default, because `default` only fires on
-- insert and the failing case was an update.

set search_path = public, extensions;

create or replace function public.plan_items_block_kind()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status = 'blocked' then
    if new.block_kind is null then
      new.block_kind := 'outside';
    end if;
  else
    new.block_kind := null;
    new.block_ask := null;
  end if;
  return new;
end;
$$;

-- Before `plan_items_touch_updated_at` in name order, which is what decides
-- the order two `before` triggers run in. Neither reads what the other writes,
-- so it only matters that it is settled.
drop trigger if exists plan_items_block_kind on plan_items;
create trigger plan_items_block_kind
  before insert or update on plan_items
  for each row execute function public.plan_items_block_kind();
