-- The newest close anywhere under a step, for the overnight runner to read.
--
-- The runner decides whether the session it last fired is still going. Its
-- first and cheapest test is "did the thing I fired at close?", and when that
-- is true the next feature goes out on the following four-minute tick. When it
-- is false the runner falls back to silence: it waits for two hours with no
-- push to main before it will believe a session has stopped.
--
-- That fallback was doing nearly all the work, because the first test asked
-- the wrong row. A run is fired at a feature, and a feature closes only when
-- every step beneath it closes -- so a feature with one blocked step, or one
-- `proposed` step, never closes at all. Worse, a session that does its job
-- well writes `proposed` steps for the follow-on work it noticed, which is
-- precisely what makes its own feature uncloseable. Doing the right thing was
-- what triggered the penalty.
--
-- The nights show it plainly. On 2026-09-18 three features closed cleanly and
-- went out 14:32, 15:00, 15:08 -- three in thirty-six minutes. The two that
-- could not close cost 3h04m and 2h00m of an idle runner each, while the
-- sessions behind them had merged to main and gone home.
--
-- So the question moves to the subtree, which is the one the runner meant:
-- has anything under this feature closed since I fired? A session that closes
-- one step of four is working, and is now visible as working within four
-- minutes rather than two hours.
--
-- Recursive rather than one level of children, because a step may have steps.
-- `max` rather than a boolean so the caller keeps comparing timestamps the way
-- `runLiveness` already does -- the cutoff is the caller's to choose, and a
-- function that baked one in would be a second copy of the rule.
--
-- `stable` and not `volatile`: it writes nothing and, within one statement,
-- the same root gives the same answer. `security invoker`, so the row-level
-- policy on `plan_items` still applies -- the cron reads as the service role
-- and bypasses it, and anybody else reading through PostgREST sees only their
-- own plan, which is the same rule as reading the table directly.

set search_path = public, extensions;

create or replace function public.plan_subtree_closed_at(root uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with recursive tree as (
    select id, completed_at from plan_items where id = root
    union all
    select child.id, child.completed_at
    from plan_items child
    join tree parent on child.parent_id = parent.id
  )
  select max(completed_at) from tree;
$$;

comment on function public.plan_subtree_closed_at(uuid) is
  'The newest completed_at on a step or anything beneath it. The overnight tick asks this to tell a session that is working from one that has stopped.';

-- Readable by the same people who can read the rows it is derived from. The
-- function is `security invoker`, so this grant hands out no reach that a
-- select on plan_items would not.
grant execute on function public.plan_subtree_closed_at(uuid) to authenticated;
revoke execute on function public.plan_subtree_closed_at(uuid) from anon;
