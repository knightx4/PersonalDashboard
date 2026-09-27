-- ===========================================================================
-- A step that waited on a merged step waits on the survivor (plan #1081).
--
-- A dependency on a dropped step counts as met (lib/goals/dependencies.ts),
-- which is right for a drop and wrong for a merge: the work did not go away,
-- it moved to the step named in merged_into (0048). Without this, merging
-- "Choose the one you care about" into "Pick the fight you will speak on"
-- made "Draft a two-minute testimony on the item you chose" ready before any
-- item was chosen.
--
-- So when a step is merged, every step that waited on it is made to wait on
-- the survivor too, as its own goals.dependencies row. The rows are written
-- in the same transaction as the merge, so the history records them against
-- the same run and actor, and each reads "Made X wait on Y" with its own
-- undo. Undoing the merge leaves them: the restored step and the survivor
-- then both hold the waiting step, which is what the tree said before.
--
-- Skipped: the survivor itself (it now carries the work it waited on), a
-- pair that already exists, and a pair that would make two steps wait on each
-- other, which goals.dependencies_check (0016) would refuse.
--
-- What the merged step itself waited on is not carried over. The survivor's
-- place in the path already says what it waits on, and the goals routine adds
-- a wait by hand when it does not (.claude/skills/goals, "Merging duplicate
-- steps").
-- ===========================================================================

create or replace function goals.items_merge_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.merged_into is null or new.merged_into is not distinct from old.merged_into then
    return null;
  end if;

  insert into goals.dependencies (user_id, item_id, depends_on_id)
  select d.user_id, d.item_id, new.merged_into
  from goals.dependencies d
  where d.depends_on_id = new.id
    and d.user_id = new.user_id
    and d.item_id <> new.merged_into
    and not exists (
      select 1 from goals.dependencies e
      where e.item_id = d.item_id and e.depends_on_id = new.merged_into
    )
    and not exists (
      with recursive chain as (
        select e.depends_on_id as id, 1 as depth
        from goals.dependencies e
        where e.item_id = new.merged_into
        union all
        select e.depends_on_id, chain.depth + 1
        from goals.dependencies e
        join chain on e.item_id = chain.id
        where chain.depth < 100
      )
      select 1 from chain where chain.id = d.item_id
    );
  return null;
end;
$$;

revoke all on function goals.items_merge_dependencies() from public, anon, authenticated;

create trigger items_merge_dependencies after update of merged_into on goals.items
  for each row execute function goals.items_merge_dependencies();
