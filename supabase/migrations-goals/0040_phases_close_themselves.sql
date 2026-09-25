-- ===========================================================================
-- A phase closes itself once everything under it is closed.
--
-- A phase is a step of yours with sub-steps (.claude/skills/goals, "Phases
-- and sub-steps"). Until now it stayed open after its last sub-step closed,
-- "for the person to tick off", so the Goals home listed finished stages as
-- things to do: Get the numbers, Choose the payoff order and Build the
-- schedule on the debt goal all read as yours with nothing left in them.
--
-- Now, when a step closes (done or dropped) and it was the last open child of
-- its parent, the parent closes as done too, and so on up the tree. Only a
-- step closes this way, never a goal, and only one that is open with at
-- least one child: a sub-step that is still proposed, open or blocked keeps
-- its phase open, and so does a rhythm, which is never done. Reopening a
-- phase by hand still works; it closes again with its next child.
--
-- The existing phases that are already finished close in the backfill below.
-- ===========================================================================

create or replace function goals.items_close_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is null
     or new.status not in ('done', 'dropped')
     or old.status in ('done', 'dropped') then
    return null;
  end if;

  update goals.items p
  set status = 'done'
  where p.id = new.parent_id
    and p.user_id = new.user_id
    and p.level = 'step'
    and p.status = 'open'
    and p.archived_at is null
    and not exists (
      select 1 from goals.items c
      where c.parent_id = p.id
        and c.archived_at is null
        and c.status not in ('done', 'dropped')
    );
  return null;
end;
$$;

revoke all on function goals.items_close_parent() from public, anon, authenticated;

create trigger items_close_parent after update of status on goals.items
  for each row execute function goals.items_close_parent();

-- Phases already finished. Deepest first, so a phase whose last open child
-- was itself a finished phase closes in the same pass.
do $$
declare
  closed integer;
begin
  loop
    update goals.items p
    set status = 'done'
    where p.level = 'step'
      and p.status = 'open'
      and p.archived_at is null
      and exists (select 1 from goals.items c where c.parent_id = p.id and c.archived_at is null)
      and not exists (
        select 1 from goals.items c
        where c.parent_id = p.id
          and c.archived_at is null
          and c.status not in ('done', 'dropped')
      );
    get diagnostics closed = row_count;
    exit when closed = 0;
  end loop;
end;
$$;
