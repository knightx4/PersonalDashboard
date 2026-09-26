-- ===========================================================================
-- Steps need no approval; a step that acts outside the plan does.
--
-- docs/GOALS-SPEC.md, "Approval". Until now a goal you added still waited on
-- you to approve its first breakdown, and steps Claude wrote after that
-- (provisional ones, a stalled goal's next move, what a re-shape found) came
-- in as proposals, each with its own Approve button. Research, a comparison or
-- a draft changes nothing outside the goal's own map, so none of that needs
-- you. What does is Claude doing something with an effect: sending an email,
-- submitting a form, buying, posting, or changing your records in another
-- part of the app.
--
--   items.acts   on a `claude` step, one sentence naming what working it
--                does outside the goal's map ("Sends the hardship request to
--                Nelnet from your Gmail"). Null for a step whose work stays
--                inside the map: research, a draft, a calculation.
--
-- A write that says it is Claude's may only put a step with `acts` in as
-- `proposed`, and may not open one, or change or add `acts` on a step that is
-- not a proposal. So the approve button on the row (settle_proposal, 0014) is
-- the one way such a step goes live, and approving it is the go-ahead for
-- exactly what the sentence says. A proposal is not sent or worked by any run
-- (lib/goals/handover.ts, lib/goals/dependencies.ts).
--
-- A goal you add is approved as you add it: a goal inserted by a signed-in
-- person, not as a proposal, gets approved_at on insert. Goals Claude proposes
-- still wait on you, with the steps under them, since adding a goal is
-- deciding what you want. Inserts with no session (seeding, admin SQL) are
-- left as they are. Goals already live without an approval are approved as of
-- when they were added.
-- ===========================================================================

alter table goals.items
  add column acts text;

alter table goals.items
  add constraint items_acts_ck check (
    acts is null
    or (level = 'step' and kind = 'claude' and length(btrim(acts)) between 1 and 500)
  );

create or replace function goals.items_acts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.acts is not null and new.status <> 'proposed' then
      raise exception 'A step that acts outside the plan waits on the person: insert it with status proposed.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.acts is distinct from old.acts and old.status <> 'proposed' then
    raise exception 'Claude may not change what a live step does outside the plan: propose a new step instead.'
      using errcode = 'check_violation';
  end if;
  if new.acts is not null and old.status = 'proposed' and new.status not in ('proposed', 'dropped') then
    raise exception 'Only the person can approve a step that acts outside the plan.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_acts_guard() from public, anon, authenticated;

create trigger items_acts_guard before insert or update on goals.items
  for each row execute function goals.items_acts_guard();

create or replace function goals.items_goal_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.level = 'goal'
     and new.status <> 'proposed'
     and new.approved_at is null
     and auth.uid() is not null
     and coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

revoke all on function goals.items_goal_approved() from public, anon, authenticated;

-- Named to run after items_claude_guard, which refuses Claude setting
-- approved_at: triggers fire in name order, and this one never acts for Claude.
create trigger items_goal_approved before insert on goals.items
  for each row execute function goals.items_goal_approved();

update goals.items
set approved_at = created_at
where level = 'goal' and status <> 'proposed' and approved_at is null;
