-- Only the person can put a plan step on themselves.
--
-- On 15 October 2026 step #2126 reached the person's Inbox under Your
-- actions, asking them to record 25 screens as unchanged by a design check.
-- None of it was theirs. The session that built the step was refused
-- permission to write the rows, blocked the step `outside` through the
-- connector, and put its own unfinished work in the ask. Every block
-- `outside` is read as waiting on the person, so a session's failure became
-- their chore.
--
-- The person's rule, given the same day: a step a run cannot finish goes to
-- one of three places, never to a bare block on them.
--
--   1. Something for them to decide: a decision step, which asks the question.
--   2. Something for them to do: a setup step, under things for them to do.
--   3. Anything the system can handle: the run handles it, or files a ready
--      step so a later run does.
--
-- Each of the three is a row the stopped step can wait on through
-- plan_dependencies, which is a block on `steps`. So a session never needs
-- `outside`, and this migration takes it away from every writer that is not
-- the person signed in to the app. The CLI, the connector and the routines run
-- with no signed-in user, so `auth.uid()` is null for them; the plan page runs
-- as the person, whose own Blocked control still means "this waits on me".
--
-- A session that says nothing about the kind gets `steps`, which reads as
-- not started once what it names has closed, or straight away if it names
-- nothing: the step goes back to the plan for a run to pick up rather than to
-- the person. A session that writes `outside` explicitly is refused with the
-- three places to go instead.

set search_path = public, extensions;

create or replace function public.plan_items_block_kind()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status = 'blocked' then
    if new.block_kind is null then
      new.block_kind := case when auth.uid() is null then 'steps' else 'outside' end;
    elsif new.block_kind = 'outside' and auth.uid() is null
      and (tg_op = 'INSERT' or old.block_kind is distinct from 'outside') then
      raise exception using
        message = 'Only the person can block a plan step on themselves.',
        hint = 'File what the step needs and let it wait on that: a decision step for '
          || 'a question (plan.ts add --kind decision), a setup step for a job of theirs '
          || '(plan.ts needs), or a ready step for anything a run can do (plan.ts add), '
          || 'then plan.ts block <n> --on <that step>. Or handle it in this run.';
    end if;
  else
    new.block_kind := null;
    new.block_ask := null;
  end if;
  return new;
end;
$$;

comment on column plan_items.block_kind is
  'Which kind of block a blocked step is carrying: ''steps'' clears itself when the steps it names close, ''outside'' waits for something only the person can supply and only the person may set (0245). Null when the step is not blocked. Required whenever status is blocked.';
