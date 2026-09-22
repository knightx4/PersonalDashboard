-- The newest block anywhere under a step, for the overnight runner to read.
--
-- 0089 added the close half of this reading: the runner asks whether anything
-- under the feature it fired at has closed since it fired, and sends the next
-- feature on the following four-minute tick when the answer is yes. A session
-- that stops to ask a question closes nothing, so it read as silence and the
-- runner waited out the no-output mark while the session behind the block had
-- already gone. #678 put the instant on the row as `blocked_at`, and this is
-- the subtree reading of it.
--
-- A second function rather than one that returns the newer of the two stamps,
-- because the two answers do not mean the same thing to every caller. The
-- overnight tick wants either: a close or a block under the feature both say
-- the session did what it could. The claim sweep in `inngest/dev/claims.ts`
-- wants only the block, since a step closing under a claim is a session
-- working through a batch rather than one that has stopped. A function that
-- folded them together would leave the sweep unable to ask its question.
--
-- `stable`, `security invoker`, and granted the way 0089 grants its pair: it
-- writes nothing, the same root gives the same answer within one statement,
-- and the row-level policy on `plan_items` still applies, so nobody reads the
-- subtree of somebody else's plan through it.

set search_path = public, extensions;

create or replace function public.plan_subtree_blocked_at(root uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with recursive tree as (
    select id, blocked_at from plan_items where id = root
    union all
    select child.id, child.blocked_at
    from plan_items child
    join tree parent on child.parent_id = parent.id
  )
  select max(blocked_at) from tree;
$$;

comment on function public.plan_subtree_blocked_at(uuid) is
  'The newest blocked_at on a step or anything beneath it. The overnight tick and the claim sweep ask this to tell a session that is working from one that stopped to ask a question.';

-- Readable by the same people who can read the rows it is derived from. The
-- function is `security invoker`, so this grant hands out no reach that a
-- select on plan_items would not.
grant execute on function public.plan_subtree_blocked_at(uuid) to authenticated;
revoke execute on function public.plan_subtree_blocked_at(uuid) from anon;
