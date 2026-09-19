-- When a step became blocked.
--
-- The row already records when a step was claimed and when it closed, and the
-- overnight runner reads the second of those to decide whether the session it
-- fired is still working. A session that stops to ask a question leaves
-- neither: blocking writes a status, an ask and a kind, and no instant. So the
-- runner falls through to the silence rules and waits out the no-output mark
-- before it will fire again, while the session behind the block has already
-- gone. #678.
--
-- `blocked_at` is the missing instant, kept the same way `started_at` is: set
-- the first time the row arrives blocked, cleared the moment it is anything
-- else. Stamping only when it is null means a second block that rewrites the
-- ask keeps the instant the step actually stopped, rather than restarting the
-- clock every time a session revisits it.
--
-- In the trigger rather than in the callers because the table has writers
-- besides the app. 0082 moved the `block_kind` default here for that reason,
-- after `tests/plan-tree.test.ts` set a status in raw SQL and took CI red; the
-- CLI, the SQL editor and that test all block a step without going through
-- `blockPatch` in lib/plan/load.ts.
--
-- No check constraint to match `plan_items_blocked_has_kind_ck`, for the same
-- reason: a constraint is what makes a writer that forgets the column fail,
-- and the trigger already fills it for every writer.
--
-- The three steps blocked today are left null rather than backfilled. Nothing
-- on the row says when they stopped -- `updated_at` is the closest guess and
-- writing it back would bump `updated_at` on all three, which is what the
-- working views order features by. A null reads as "no block since this run
-- started", which is the answer those rows already give, and the next status
-- write stamps them for real.

set search_path = public, extensions;

alter table plan_items
  add column if not exists blocked_at timestamptz;

comment on column plan_items.blocked_at is
  'When the step became blocked, stamped by plan_items_track_status and cleared when it stops being blocked. Written by the trigger, never by a caller. The overnight runner reads it to tell a session that blocked its step from one that went quiet.';

-- The trigger 0070 left, with the block added. `started_at` and `completed_at`
-- are unchanged.
create or replace function public.plan_items_track_status()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status = 'not_started' then
    new.started_at := null;
  end if;

  if new.status = 'blocked' then
    if new.blocked_at is null then
      new.blocked_at := now();
    end if;
  else
    new.blocked_at := null;
  end if;

  if new.status in ('done', 'dropped') then
    if tg_op = 'INSERT' or old.status not in ('done', 'dropped') then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;
