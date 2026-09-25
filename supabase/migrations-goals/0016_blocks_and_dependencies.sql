-- ===========================================================================
-- Blocked goal steps, and steps that wait on other steps (plan #981).
--
-- A goal step can now stop for a reason and wait on other steps, the same as
-- a step on the dev plan (supabase/migrations/0052, 0076, 0081 and 0082):
--
--   items.status   gains `blocked`, for a step only. A goal is not blocked;
--                  its steps are.
--   block_ask      what a blocked step needs, in one sentence. It is the
--                  Needs line of the opened step.
--   block_kind     who clears the block: 'steps' when it waits on the steps
--                  it depends on and clears itself once they close, 'outside'
--                  when it waits on you. Required whenever the step is
--                  blocked, and 'outside' when a write does not say.
--   dependencies   one row per "this step cannot start until that one is
--                  closed". Waiting on a step is a relation rather than a
--                  status, so it clears itself when the other step closes.
--
-- Leaving `blocked` clears block_ask and block_kind, as it does on the plan:
-- both are claims about work that has stopped. A trigger does it, so a
-- routine writing SQL directly cannot leave a stale ask behind.
--
-- Both ends of a dependency are steps of the same account, and following
-- "depends on" from the far end must never arrive back at the near one. The
-- composite foreign keys hold the account; the trigger holds the level and
-- the loop, with the plan's own wording.
--
-- Dependencies are written to goals.history like every other goals table.
-- ===========================================================================

set search_path = goals, public, extensions;

-- ---------------------------------------------------------------------------
-- items: blocked, block_ask, block_kind
-- ---------------------------------------------------------------------------
alter table goals.items add column block_ask text;
alter table goals.items add column block_kind text;

comment on column goals.items.block_ask is
  'What a blocked step needs, in one sentence. Cleared when the step is no longer blocked.';
comment on column goals.items.block_kind is
  'Who clears a blocked step: ''steps'' clears itself when the steps it depends on close, ''outside'' waits for you. Null when the step is not blocked.';

alter table goals.items drop constraint items_status_ck;
alter table goals.items add constraint items_status_ck
  check (status in ('proposed', 'open', 'blocked', 'done', 'dropped'));

alter table goals.items add constraint items_blocked_step_ck
  check (status <> 'blocked' or level = 'step');
alter table goals.items add constraint items_block_kind_ck
  check (block_kind is null or block_kind in ('steps', 'outside'));
alter table goals.items add constraint items_blocked_has_kind_ck
  check (status <> 'blocked' or block_kind is not null);
alter table goals.items add constraint items_block_ask_ck
  check (block_ask is null or (btrim(block_ask) <> '' and length(block_ask) <= 4000));

create or replace function goals.items_block_kind()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'blocked' then
    if new.block_kind is null then
      new.block_kind := 'outside';
    end if;
  else
    new.block_kind := null;
    new.block_ask := null;
  end if;
  return new;
end;
$$;

alter function goals.items_block_kind() set search_path = goals;
revoke all on function goals.items_block_kind() from public, anon, authenticated;

create trigger items_block_kind before insert or update on goals.items
  for each row execute function goals.items_block_kind();

-- ---------------------------------------------------------------------------
-- dependencies
-- ---------------------------------------------------------------------------
create table goals.dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  depends_on_id uuid not null,

  created_at timestamptz not null default now(),

  constraint dependencies_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint dependencies_depends_on_fk foreign key (depends_on_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint dependencies_pair_key unique (item_id, depends_on_id),
  constraint dependencies_not_self_ck check (item_id <> depends_on_id)
);

create index dependencies_user_depends_on_idx on goals.dependencies (user_id, depends_on_id);

create or replace function goals.dependencies_check()
returns trigger
language plpgsql
set search_path = goals, public, extensions
as $$
declare
  steps integer;
  loops boolean;
begin
  select count(*) into steps
    from goals.items
   where id in (new.item_id, new.depends_on_id)
     and user_id = new.user_id
     and level = 'step';

  if steps <> 2 then
    raise exception 'Both ends have to be steps of your own.'
      using errcode = 'foreign_key_violation';
  end if;

  with recursive chain as (
    select depends_on_id as id, 1 as depth
      from goals.dependencies
     where item_id = new.depends_on_id
    union all
    select d.depends_on_id, chain.depth + 1
      from goals.dependencies d
      join chain on d.item_id = chain.id
     where chain.depth < 100
  )
  select exists (select 1 from chain where chain.id = new.item_id) into loops;

  if loops then
    raise exception 'That would make the two steps wait on each other.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function goals.dependencies_check() from public, anon, authenticated;

create trigger dependencies_check before insert or update on goals.dependencies
  for each row execute function goals.dependencies_check();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies'
  )
);

create trigger dependencies_history after insert or update or delete on goals.dependencies
  for each row execute function goals.record_history();

alter table goals.dependencies enable row level security;

create policy dependencies_all on goals.dependencies for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.dependencies from anon, public;
grant select, insert, delete on goals.dependencies to authenticated, service_role;

notify pgrst, 'reload schema';
