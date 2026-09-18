-- ---------------------------------------------------------------------------
-- 0006 -- a task can sit under another task.
--
-- One big thing broken into smaller ones: "Renew the passport" holds "find the
-- old one", "get photos taken", "post the form". Each item is an ordinary task
-- row -- it has a title, a status, a due date and the same trigger stamping
-- its completed_at -- and the only new fact is which task it belongs to.
--
-- An item is not a second kind of row and must not become one. Everything the
-- module already does to a task (tick, drop, defer, delete, search, link to a
-- role) keeps working on an item for free, because an item IS a task. That is
-- the whole argument for a self-referencing column over a second table.
--
-- ONE LEVEL ONLY. Plan #259 settled that: a task holds items, and an item
-- holds nothing. Enforced below by a trigger rather than trusted to the app,
-- because "refuses a third level outright" is a claim about the data and the
-- app is not the only thing that writes to it. Allowing depth later is
-- dropping the trigger; taking depth away once rows are three deep is a
-- migration that has to decide what to do with them.
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

-- Cascading, so removing the holding task removes the list with it. The
-- alternative -- orphaning the items to the top level -- makes deleting a task
-- scatter six rows across the agenda, which is not what anyone means by it.
alter table todo.tasks
  add column if not exists parent_id uuid references todo.tasks (id) on delete cascade;

-- A row cannot name itself. The trigger below would catch this as a depth
-- violation once the row had a parent, but a constraint says it at the table
-- and holds even if the trigger is dropped.
alter table todo.tasks
  add constraint tasks_parent_not_self_ck check (parent_id is distinct from id);

-- The read this exists for: the items under these tasks, for this account.
create index if not exists tasks_user_parent_idx on todo.tasks (user_id, parent_id);

comment on column todo.tasks.parent_id is
  'The task this one sits under, or null for a task of its own. One level '
  'only: a task with a parent cannot be named as one. Cascades on delete.';

-- ---------------------------------------------------------------------------
-- The depth limit, and who owns the task being pointed at.
--
-- Two things a check constraint cannot express, because both are facts about a
-- DIFFERENT row:
--
--   1. Depth. A row may point at a task that holds nothing, and may be pointed
--      at only while it points at nothing itself. Both directions are checked,
--      or the rule is only half there: forbidding an item from being given
--      items still lets a task that HAS items be filed under another one, and
--      that is a third level by a different route.
--
--   2. Ownership. **A foreign key is not an ownership check** -- the same fact
--      todo.task_links already has a trigger for. Postgres performs
--      referential integrity checks bypassing row level security, so this new
--      key is satisfied by any task in the table, including another account's,
--      and the policy on todo.tasks only asks who owns the row being written.
--      Nothing else stops one account filing its task under another's.
--
-- security definer for the second one: the parent row belongs to somebody else
-- in exactly the case being rejected, so the caller's own policies would hide
-- it and the lookup would come back empty -- reading as "no such task" and
-- being allowed through. Written narrowly, pinned to a fixed search_path, and
-- revoked from every role that could call it directly, for the same reason.
-- ---------------------------------------------------------------------------
create or replace function todo.task_parent_is_valid()
returns trigger
language plpgsql
security definer
set search_path = todo
as $$
declare
  parent_owner uuid;
  parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select user_id, parent_id into parent_owner, parent_parent
  from todo.tasks
  where id = new.parent_id;

  -- No such task: let the foreign key speak. A BEFORE trigger runs first, and
  -- answering "that task does not exist" with "you do not own it" would send
  -- someone looking for a permissions problem they do not have.
  if parent_owner is null then
    return new;
  end if;

  if parent_owner <> new.user_id then
    raise exception 'a task must sit under a task its owner owns';
  end if;

  if parent_parent is not null then
    raise exception 'a task that sits under another task cannot hold a list of its own';
  end if;

  if exists (select 1 from todo.tasks where parent_id = new.id) then
    raise exception 'a task that holds a list cannot itself sit under another task';
  end if;

  return new;
end;
$$;

alter function todo.task_parent_is_valid() set search_path = todo;
revoke all on function todo.task_parent_is_valid() from public, anon, authenticated;

-- `update of parent_id, user_id` rather than every update: those are the only
-- two columns whose value can break the rule, so ticking an item off does not
-- pay for a lookup. It fires whenever either is named in the statement, value
-- changed or not, which is the safe side of that choice.
create trigger tasks_parent_is_valid
  before insert or update of parent_id, user_id on todo.tasks
  for each row execute function todo.task_parent_is_valid();
