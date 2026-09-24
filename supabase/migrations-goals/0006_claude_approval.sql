-- ===========================================================================
-- Approval once per goal, and what Claude may change before and after it
-- (plan #932).
--
-- docs/GOALS-SPEC.md, "Approval": Claude proposes and you approve, once per
-- goal. Before a goal is approved, the steps Claude writes under it are
-- proposals. Once you approve it, Claude may add, split and reorder steps
-- beneath it without asking. It may never add a goal outright, change a
-- goal's done-when, drop or archive one of your steps, or answer a question
-- it asked you. Those stay proposals, or questions.
--
-- The goals routine (.claude/skills/goals) writes through SQL with
-- `set local goals.actor = 'claude'`, which is also what labels its changes in
-- the history. The guard below reads the same setting (or the x-goals-actor
-- header) and holds those writes to the rules above. It applies only when the
-- write says it is Claude's: SQL with no actor declared, such as seeding a
-- test database, is not checked, although the history still records it as
-- Claude's. The skill makes declaring the actor the first line of every write.
--
-- Approving is goals.approve_goal(), called by the signed-in person. It sets
-- approved_at on the goal, opens the goal itself if Claude proposed it, and
-- opens every proposed step beneath it, in one statement each so the history
-- shows one update per row.
-- ===========================================================================

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

  -- Your own steps are not Claude's to drop or archive, before or after approval.
  if old.kind in ('mine', 'rhythm') and old.status <> 'proposed'
     and (new.status = 'dropped' and old.status <> 'dropped'
          or new.archived_at is not null and old.archived_at is null) then
    raise exception 'Claude may not drop or archive one of your steps. Ask with a question step instead.'
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

create trigger items_claude_guard before insert or update on goals.items
  for each row execute function goals.items_claude_guard();

-- ---------------------------------------------------------------------------
-- Approve a goal. Runs as the caller, so row level security limits it to the
-- caller's own goal. Returns how many proposed steps it opened, or null when
-- there is no live goal with that id.
-- ---------------------------------------------------------------------------
create or replace function goals.approve_goal(goal uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  opened integer;
begin
  update goals.items
  set approved_at = coalesce(approved_at, now()),
      status = case when status = 'proposed' then 'open' else status end
  where id = goal and level = 'goal' and archived_at is null;
  if not found then
    return null;
  end if;

  with recursive tree as (
    select i.id from goals.items i where i.parent_id = goal and i.archived_at is null
    union all
    select c.id from goals.items c join tree t on c.parent_id = t.id where c.archived_at is null
  )
  update goals.items
  set status = 'open'
  where id in (select id from tree) and status = 'proposed';
  get diagnostics opened = row_count;
  return opened;
end;
$$;

revoke all on function goals.approve_goal(uuid) from public, anon;
grant execute on function goals.approve_goal(uuid) to authenticated, service_role;
