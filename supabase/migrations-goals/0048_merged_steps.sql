-- ===========================================================================
-- Claude merges duplicate steps (plan #1081).
--
-- The live tree had three steps asking for the same pay floor and phases
-- whose one remaining sub-step of yours said the same thing as the phase.
-- Until now Claude could add and reorder steps but never drop one of yours
-- (0006, restated in 0042), so nothing cleaned these up.
--
--   items.merged_into   on a dropped step, the step that now carries its
--                       work. Null on every other row.
--
-- A merge is one update on the duplicate: status 'dropped' and merged_into
-- set, together. The history trigger records it as one row, so the run's page
-- and the Goals home list it as one line, "Merged X into Y", and its Undo
-- puts both columns back, which restores the step.
--
-- What a merge may do, checked for every writer:
--
--   - the survivor is a live step (open or blocked, not archived) of the same
--     account and the same goal, and not the merged step itself;
--   - the merged step has nothing open beneath it: its open sub-steps are
--     merged or moved first, so no work is left under a dropped step.
--
-- items_claude_guard (0006) keeps refusing Claude a plain drop or archive of
-- one of your steps. The one drop it now allows is a merge.
--
-- Phases (0040). A sub-step merged into its own phase leaves the phase as the
-- step that carries the work, so it must not close the phase as done. And a
-- phase that has taken in one of its sub-steps holds your part of it now, so
-- it no longer closes itself when its other sub-steps close; you tick it off.
-- A merge elsewhere does not close its phase either: the routine decides what
-- happens to a phase a merge has emptied (.claude/skills/goals, "Merging
-- duplicate steps").
--
-- Reopening a merged step by hand, or by the undo, clears merged_into.
-- ===========================================================================

alter table goals.items
  add column merged_into uuid;

alter table goals.items
  add constraint items_merged_into_fk foreign key (merged_into, user_id)
    references goals.items (id, user_id) on delete set null (merged_into);

alter table goals.items
  add constraint items_merged_into_ck check (
    merged_into is null or (status = 'dropped' and level = 'step' and merged_into <> id)
  );

create index items_merged_into_idx on goals.items (merged_into) where merged_into is not null;

comment on column goals.items.merged_into is
  'On a dropped step, the step that now carries its work (plan #1081). Set with the drop, cleared when the step reopens.';

-- ---------------------------------------------------------------------------
-- The goal at the top of an item's branch. The walk is capped so a damaged
-- tree cannot loop.
-- ---------------------------------------------------------------------------
create or replace function goals.goal_of(item uuid, owner uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  with recursive up as (
    select i.id, i.parent_id, i.level, 1 as depth
    from goals.items i
    where i.id = item and i.user_id = owner
    union all
    select p.id, p.parent_id, p.level, up.depth + 1
    from goals.items p
    join up on p.id = up.parent_id
    where p.user_id = owner and up.depth < 100
  )
  select up.id from up where up.level = 'goal' limit 1;
$$;

revoke all on function goals.goal_of(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Holding a merge to the rules above.
-- ---------------------------------------------------------------------------
create or replace function goals.items_merge_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  survivor goals.items%rowtype;
begin
  if new.status <> 'dropped' then
    new.merged_into := null;
    return new;
  end if;

  if new.merged_into is null
     or (tg_op = 'UPDATE' and new.merged_into is not distinct from old.merged_into) then
    return new;
  end if;

  select * into survivor
  from goals.items s
  where s.id = new.merged_into and s.user_id = new.user_id;

  if not found or survivor.level <> 'step' or survivor.id = new.id then
    raise exception 'A step can only be merged into another step of the same goal.'
      using errcode = 'check_violation';
  end if;
  if survivor.status not in ('open', 'blocked') or survivor.archived_at is not null then
    raise exception 'Merge into a step that is still open: "%" is %.', survivor.title,
      case when survivor.archived_at is not null then 'archived' else survivor.status end
      using errcode = 'check_violation';
  end if;
  if goals.goal_of(survivor.id, new.user_id) is distinct from goals.goal_of(new.id, new.user_id) then
    raise exception 'A step can only be merged into another step of the same goal.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from goals.items c
    where c.parent_id = new.id
      and c.user_id = new.user_id
      and c.archived_at is null
      and c.status not in ('done', 'dropped')
  ) then
    raise exception '"%" still has open sub-steps: merge or move them first.', new.title
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_merge_check() from public, anon, authenticated;

create trigger items_merge_check before insert or update on goals.items
  for each row execute function goals.items_merge_check();

-- ---------------------------------------------------------------------------
-- 0006's guard, with the one drop of your steps it now allows: a merge.
-- ---------------------------------------------------------------------------
create or replace function goals.items_claude_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  root_approved timestamptz;
  root_found boolean := false;
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;

  -- Answering a question is yours, wherever it sits.
  if tg_op = 'UPDATE' and new.resolution is distinct from old.resolution then
    raise exception 'Claude may not answer a question: only you write a resolution.'
      using errcode = 'check_violation';
  end if;

  -- Approving is yours too.
  if (tg_op = 'INSERT' and new.approved_at is not null)
     or (tg_op = 'UPDATE' and new.approved_at is distinct from old.approved_at) then
    raise exception 'Claude may not approve a goal.'
      using errcode = 'check_violation';
  end if;

  if new.level = 'goal' then
    if tg_op = 'INSERT' then
      if new.status <> 'proposed' then
        raise exception 'Claude may propose a goal but not add one: insert it with status proposed.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
    -- A goal Claude proposed is its own to edit or withdraw until you approve it.
    if old.status = 'proposed' then
      if new.status not in ('proposed', 'dropped') then
        raise exception 'Claude may not open a goal it proposed: approving it is yours.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if new.acceptance is distinct from old.acceptance then
      raise exception 'Claude may not change a goal''s done-when. Ask with a question step instead.'
        using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status or new.archived_at is distinct from old.archived_at then
      raise exception 'Claude may not close, drop or archive a goal. Ask with a question step instead.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- A step: find the goal at the top of its branch. The walk is capped so a
  -- damaged tree cannot loop.
  with recursive up as (
    select i.id, i.parent_id, i.level, i.approved_at, 1 as depth
    from goals.items i
    where i.id = new.parent_id and i.user_id = new.user_id
    union all
    select p.id, p.parent_id, p.level, p.approved_at, up.depth + 1
    from goals.items p
    join up on p.id = up.parent_id
    where p.user_id = new.user_id and up.depth < 100
  )
  select up.approved_at, true into root_approved, root_found
  from up where up.level = 'goal' limit 1;

  if tg_op = 'INSERT' then
    if root_found and root_approved is null
       and new.status <> 'proposed'
       and not (new.kind = 'decision' and new.status = 'open') then
      raise exception 'This goal is not approved yet: Claude''s steps under it go in as proposed (a question may go in open).'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Your own steps are not Claude's to drop or archive, before or after
  -- approval, except that a duplicate may be merged into the step that
  -- carries the same work (items_merge_check holds the merge to its rules).
  if old.kind in ('mine', 'rhythm') and old.status <> 'proposed'
     and (new.archived_at is not null and old.archived_at is null
          or new.status = 'dropped' and old.status <> 'dropped'
             and not (new.merged_into is not null and root_approved is not null)) then
    raise exception 'Claude may not drop or archive one of your steps except by merging it into another step of an approved goal (merged_into). Ask with a question step instead.'
      using errcode = 'check_violation';
  end if;

  if root_found and root_approved is null then
    if old.status = 'proposed' then
      if new.status not in ('proposed', 'dropped') then
        raise exception 'This goal is not approved yet: only you can turn a proposed step into a live one.'
          using errcode = 'check_violation';
      end if;
    elsif not (old.kind = 'claude' or (old.kind = 'decision' and old.resolution is null)) then
      raise exception 'This goal is not approved yet: Claude may change only its own proposals, questions and Claude steps under it.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function goals.items_claude_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 0040's phase close, leaving alone a merge and a phase that took one in.
-- ---------------------------------------------------------------------------
create or replace function goals.items_close_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is null
     or new.merged_into is not null
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
    )
    and not exists (
      select 1 from goals.items c
      where c.parent_id = p.id
        and c.merged_into = p.id
    );
  return null;
end;
$$;

revoke all on function goals.items_close_parent() from public, anon, authenticated;
