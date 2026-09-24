-- ===========================================================================
-- Settling one proposal at a time, and putting a goal's fog aside (plan #960).
--
-- docs/GOALS-SPEC.md, "Taken from the dev plan": approve or reject one
-- proposed step, and the goal's fog shown under it.
--
-- Approving a whole goal (0006, approve_goal) opens everything Claude
-- proposed under it. goals.settle_proposal() is the smaller move: yes or no
-- to one proposed step and the proposed steps beneath it, leaving the rest of
-- the goal's proposals waiting.
--
--   approve  the step opens, with every proposed step beneath it. The goal
--            stays unapproved, so Claude's later steps under it are still
--            proposals.
--   reject   the step is dropped, with every proposed step beneath it and any
--            unanswered question beneath it, since a question about a step you
--            turned down has nothing left to decide. The drop is an update like
--            any other, so the history trigger records each row it closed.
--
-- Runs as the caller, so row level security limits it to the caller's own
-- steps. Returns how many rows it changed, or null when the id is not a live
-- proposed step. It needs no guard of its own: a write that says it is
-- Claude's still passes through items_claude_guard (0006), which refuses it
-- opening a proposal under a goal you have not approved.
--
--   items.fog_dismissed_at  when you put the fog on a goal aside with Not
--                           now; null while it shows. Only a row with fog can
--                           have one, and rewriting the fog clears it, since a
--                           new note on what is not known is not one you have
--                           put aside. The dev plan's column of the same name
--                           (0063_plan_dismissals) works the same way.
--
-- Putting fog aside is yours, as putting a question aside is (0012): a write
-- that says it is Claude's may not set or clear it, except by rewriting the
-- fog itself.
-- ===========================================================================

alter table goals.items
  add column fog_dismissed_at timestamptz;

alter table goals.items
  add constraint items_fog_dismissed_ck check (fog_dismissed_at is null or fog is not null);

create or replace function goals.items_fog_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.fog is distinct from old.fog then
    new.fog_dismissed_at := null;
    return new;
  end if;
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.fog_dismissed_at is not null)
     or (tg_op = 'UPDATE' and new.fog_dismissed_at is distinct from old.fog_dismissed_at) then
    raise exception 'Claude may not put fog aside or bring it back: only you do that.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_fog_guard() from public, anon, authenticated;

create trigger items_fog_guard before insert or update on goals.items
  for each row execute function goals.items_fog_guard();

create or replace function goals.settle_proposal(step uuid, approve boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  settled integer;
begin
  perform 1 from goals.items
  where id = step and level = 'step' and status = 'proposed' and archived_at is null;
  if not found then
    return null;
  end if;

  with recursive tree as (
    select i.id from goals.items i where i.id = step
    union all
    select c.id from goals.items c join tree t on c.parent_id = t.id where c.archived_at is null
  )
  update goals.items
  set status = case when approve then 'open' else 'dropped' end
  where id in (select id from tree)
    and (status = 'proposed'
         or (not approve and kind = 'decision' and status = 'open' and resolution is null));
  get diagnostics settled = row_count;
  return settled;
end;
$$;

revoke all on function goals.settle_proposal(uuid, boolean) from public, anon;
grant execute on function goals.settle_proposal(uuid, boolean) to authenticated, service_role;
