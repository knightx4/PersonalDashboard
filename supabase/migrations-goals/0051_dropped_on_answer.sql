-- ===========================================================================
-- Claude drops a step of yours on your answer (plan #1083).
--
-- A step of yours that has sat untouched for a week gets a move from the
-- morning run: split into smaller steps, prepared for you, or turned into a
-- question asking whether you still want it. The question is a `decision`
-- step beside it, and the step waits on it (goals.dependencies), so it
-- leaves the runs until you answer. The question cannot sit beneath the step:
-- answering would close its last sub-step, and 0040 would then close the
-- step as done.
--
-- When the answer is that you no longer want it, the re-shape run drops the
-- step. Until now the guard (0006, 0048) refused Claude any drop of your
-- steps other than a merge, so the answer had nowhere to go. One column
-- carries the drop:
--
--   items.dropped_on   on a dropped step, the answered question it was
--                      dropped on. Null on every other row.
--
-- The drop is one update, status 'dropped' and dropped_on together, so the
-- history trigger records it as one row. The run's page and the Goals home
-- read it as "Dropped X on your answer to Y", and its Undo puts both columns
-- back, which reopens the step.
--
-- What the database holds a drop on an answer to, for every writer:
--
--   - the question is a decision of the same account and goal, and it has
--     your answer (a resolution);
--   - the step waits on that question, so it was asked about this step;
--   - the step has nothing open beneath it.
--
-- Whether the answer says to drop it is the routine's reading and is not
-- checked here; the undo is what covers a wrong reading. Reopening the step,
-- by hand or by the undo, clears dropped_on.
-- ===========================================================================

alter table goals.items
  add column dropped_on uuid;

alter table goals.items
  add constraint items_dropped_on_fk foreign key (dropped_on, user_id)
    references goals.items (id, user_id) on delete set null (dropped_on);

alter table goals.items
  add constraint items_dropped_on_ck check (
    dropped_on is null or (status = 'dropped' and level = 'step' and dropped_on <> id)
  );

create index items_dropped_on_idx on goals.items (dropped_on) where dropped_on is not null;

comment on column goals.items.dropped_on is
  'On a dropped step, the answered question it was dropped on (plan #1083). Set with the drop, cleared when the step reopens.';

-- ---------------------------------------------------------------------------
-- Holding a drop on an answer to the rules above.
-- ---------------------------------------------------------------------------
create or replace function goals.items_dropped_on_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  question goals.items%rowtype;
begin
  if new.status <> 'dropped' then
    new.dropped_on := null;
    return new;
  end if;

  if new.dropped_on is null
     or (tg_op = 'UPDATE' and new.dropped_on is not distinct from old.dropped_on) then
    return new;
  end if;

  select * into question
  from goals.items q
  where q.id = new.dropped_on and q.user_id = new.user_id;

  if not found or question.kind is distinct from 'decision' or question.id = new.id then
    raise exception 'A step can only be dropped on the answer to a question.'
      using errcode = 'check_violation';
  end if;
  if question.resolution is null then
    raise exception 'The question "%" has no answer yet: a step is dropped on your answer, not before it.', question.title
      using errcode = 'check_violation';
  end if;
  if goals.goal_of(question.id, new.user_id) is distinct from goals.goal_of(new.id, new.user_id) then
    raise exception 'A step can only be dropped on a question of the same goal.'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from goals.dependencies d
    where d.item_id = new.id
      and d.depends_on_id = question.id
      and d.user_id = new.user_id
  ) then
    raise exception '"%" does not wait on the question "%", so that answer was not about it.', new.title, question.title
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from goals.items c
    where c.parent_id = new.id
      and c.user_id = new.user_id
      and c.archived_at is null
      and c.status not in ('done', 'dropped')
  ) then
    raise exception '"%" still has open sub-steps: settle them first.', new.title
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_dropped_on_check() from public, anon, authenticated;

create trigger items_dropped_on_check before insert or update on goals.items
  for each row execute function goals.items_dropped_on_check();

-- ---------------------------------------------------------------------------
-- 0048's guard, with the second drop of your steps it now allows.
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
  -- carries the same work (items_merge_check holds the merge to its rules),
  -- and a step you said you no longer want may be dropped on that answer
  -- (items_dropped_on_check, 0051).
  if old.kind in ('mine', 'rhythm') and old.status <> 'proposed'
     and (new.archived_at is not null and old.archived_at is null
          or new.status = 'dropped' and old.status <> 'dropped'
             and not ((new.merged_into is not null or new.dropped_on is not null)
                      and root_approved is not null)) then
    raise exception 'Claude may not drop or archive one of your steps except by merging it into another step of an approved goal (merged_into), or on your answer to a question it waits on (dropped_on). Ask with a question step instead.'
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

notify pgrst, 'reload schema';
