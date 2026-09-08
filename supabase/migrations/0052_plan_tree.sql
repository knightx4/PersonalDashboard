-- The plan becomes a tree, and a step becomes something that can be worked.
--
-- 0051 made the build order a flat list per module, which was the right first
-- shape and the wrong last one. A feature is not one step: "share links" was
-- a schema, two RPCs, an anonymous page and a form, and a list that holds
-- either the feature or its parts loses the other. So a step may now sit under
-- another step, to any depth -- the high-level features at the top, the pieces
-- that get you there beneath, and their pieces beneath those. `parent_id`
-- cascades on delete: a feature taken out of the plan takes its steps with it,
-- which is what deleting a feature means.
--
-- The rest is what an issue tracker knows that a list does not, kept to the
-- parts that change what gets picked up next:
--
--   number       A stable, short handle -- "#12" -- per account. Titles change
--                and uuids are unreadable in a commit message; this is the
--                thing a commit and a conversation can refer to.
--   priority     1 next, 2 normal, 3 someday. The same three the notes queue
--                uses, so one person's sense of "urgent" means one thing.
--   size         s, m or l. Coarse on purpose: the question it answers is
--                "can this be done in one sitting", not how many hours.
--   assignee     'me' or 'claude'. This is the plan's reason to exist: a step
--                handed to Claude is one the routine may pick up on its own.
--   acceptance   Done when. Written before the work, it is what the work is
--                checked against; without it "done" is whoever's opinion.
--   commit_sha   The commit that shipped it, as the notes queue records.
--   started_at, completed_at
--                Kept by a trigger from the status, so the CLI and the page
--                cannot disagree about when.
--
-- `blocked` joins the statuses, which 0051 said it would. It is the state you
-- set by hand for something waiting on the outside world; waiting on another
-- step is not a status but a relation, and lives in `plan_dependencies` below
-- so that it clears itself the moment the other step is done.
--
-- Two triggers guard the shape. One refuses a parent that is not your own
-- step or that would make a step its own ancestor; the other refuses a
-- dependency that loops. Both walk the tree with a recursive query bounded at
-- a depth no real plan reaches, so a bug can never make them spin forever.

set search_path = public, extensions;

-- ---------------------------------------------------------------- columns

alter table plan_items
  add column if not exists parent_id uuid references plan_items (id) on delete cascade,
  add column if not exists number integer,
  add column if not exists priority smallint not null default 2,
  add column if not exists size text,
  add column if not exists assignee text,
  add column if not exists acceptance text,
  add column if not exists commit_sha text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table plan_items drop constraint if exists plan_items_status_ck;
alter table plan_items add constraint plan_items_status_ck
  check (status in ('not_started', 'in_progress', 'blocked', 'done', 'dropped'));

alter table plan_items drop constraint if exists plan_items_priority_ck;
alter table plan_items add constraint plan_items_priority_ck
  check (priority in (1, 2, 3));

alter table plan_items drop constraint if exists plan_items_size_ck;
alter table plan_items add constraint plan_items_size_ck
  check (size is null or size in ('s', 'm', 'l'));

alter table plan_items drop constraint if exists plan_items_assignee_ck;
alter table plan_items add constraint plan_items_assignee_ck
  check (assignee is null or assignee in ('me', 'claude'));

alter table plan_items drop constraint if exists plan_items_acceptance_length_ck;
alter table plan_items add constraint plan_items_acceptance_length_ck
  check (acceptance is null or length(acceptance) <= 4000);

alter table plan_items drop constraint if exists plan_items_commit_sha_length_ck;
alter table plan_items add constraint plan_items_commit_sha_length_ck
  check (commit_sha is null or length(commit_sha) <= 64);

alter table plan_items drop constraint if exists plan_items_not_own_parent_ck;
alter table plan_items add constraint plan_items_not_own_parent_ck
  check (parent_id is null or parent_id <> id);

-- ---------------------------------------------------------------- numbers
--
-- Existing rows are numbered in reading order -- module by module, top to
-- bottom -- so the numbers a person sees on the page the first time are the
-- ones they would have guessed. Nulls last puts the app-wide steps after the
-- modules, which is where the page shows them.

with numbered as (
  select
    id,
    row_number() over (
      partition by user_id
      order by module nulls last, position, created_at, id
    ) as n
  from plan_items
)
update plan_items as p
set number = numbered.n
from numbered
where p.id = numbered.id and p.number is null;

alter table plan_items alter column number set not null;

create unique index if not exists plan_items_user_number_key
  on plan_items (user_id, number);

create index if not exists plan_items_user_parent_idx
  on plan_items (user_id, parent_id, position);

-- The next number for the account, from a counter on the profile rather than
-- from max(number) + 1: a number is a handle that commit messages and
-- conversations refer to, so one must never come back once its step is gone
-- -- and deleting the newest step and adding another is exactly how max + 1
-- would hand the same number to two different things. The row-level update is
-- also what serialises two inserts landing at once. The counter is never
-- allowed to fall behind a number written by hand, so the unique index above
-- stays a guard rather than something anyone meets.
--
-- Reads and writes under the caller's own policies: an account may update its
-- own profile, and the service role sees every one, held to the account by the
-- where clause.

alter table profiles
  add column if not exists plan_last_number integer not null default 0;

update profiles as p
set plan_last_number = greatest(
  p.plan_last_number,
  coalesce((select max(number) from plan_items where user_id = p.id), 0)
);

create or replace function public.plan_items_assign_number()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.number is null then
    update profiles
       set plan_last_number = plan_last_number + 1
     where id = new.user_id
    returning plan_last_number into new.number;

    -- No profile row, which the sign-up trigger should make impossible. Count
    -- rather than fail, so a plan is never the thing that cannot be written.
    if new.number is null then
      select coalesce(max(number), 0) + 1
        into new.number
        from plan_items
       where user_id = new.user_id;
    end if;
  else
    update profiles
       set plan_last_number = greatest(plan_last_number, new.number)
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists plan_items_assign_number on plan_items;
create trigger plan_items_assign_number
  before insert on plan_items
  for each row execute function public.plan_items_assign_number();

-- ---------------------------------------------------------------- the tree
--
-- A parent has to be a step of the same account, and moving a step under one
-- of its own descendants would cut a loop into the tree that every walk over
-- it would then follow forever. The foreign key cannot say either of those,
-- so a trigger does. The parent lookup runs under the caller's policies, which
-- is what makes "not yours" and "does not exist" the same answer.

create or replace function public.plan_items_check_parent()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  parent_user uuid;
  loops boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  select user_id into parent_user from plan_items where id = new.parent_id;
  if parent_user is null or parent_user <> new.user_id then
    raise exception 'The parent step does not exist.'
      using errcode = 'foreign_key_violation';
  end if;

  -- Only an update can close a loop: a row being inserted has no descendants.
  if tg_op = 'UPDATE' then
    with recursive up as (
      select id, parent_id, 1 as depth from plan_items where id = new.parent_id
      union all
      select p.id, p.parent_id, up.depth + 1
        from plan_items p
        join up on p.id = up.parent_id
       where up.depth < 100
    )
    select exists (select 1 from up where up.id = new.id) into loops;

    if loops then
      raise exception 'A step cannot be moved under one of its own sub-steps.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_items_check_parent on plan_items;
create trigger plan_items_check_parent
  before insert or update of parent_id, user_id on plan_items
  for each row execute function public.plan_items_check_parent();

-- ---------------------------------------------------------------- timestamps
--
-- When a step was started and when it was finished, kept from the status
-- rather than written by whoever changed it. Done and dropped both count as
-- finished, the way a declined note carries a completion time; a step
-- reopened loses its completion time, because it is no longer complete.

create or replace function public.plan_items_track_status()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
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

drop trigger if exists plan_items_track_status on plan_items;
create trigger plan_items_track_status
  before insert or update of status on plan_items
  for each row execute function public.plan_items_track_status();

-- ---------------------------------------------------------------- dependencies
--
-- "Cannot start until that one is done." A relation rather than a status
-- because it clears itself: the moment the other step is done, this one is
-- ready, and nobody has to remember to come back and unblock it.
--
-- One direction only. `item_id` waits on `depends_on_id`; the reverse reading
-- ("this unblocks that") is the same row read the other way. A surrogate `id`
-- rather than the composite key alone, because every table in this schema is
-- addressed by `id` -- the cross-user test above all.

create table if not exists plan_dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references plan_items (id) on delete cascade,
  depends_on_id uuid not null references plan_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint plan_dependencies_pair_key unique (item_id, depends_on_id),
  constraint plan_dependencies_not_self_ck check (item_id <> depends_on_id)
);

create index if not exists plan_dependencies_user_depends_on_idx
  on plan_dependencies (user_id, depends_on_id);

-- Both ends have to be the account's own steps, and following "depends on"
-- from the far end must never arrive back at the near one.
create or replace function public.plan_dependencies_check()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  owners integer;
  loops boolean;
begin
  select count(*) into owners
    from plan_items
   where id in (new.item_id, new.depends_on_id)
     and user_id = new.user_id;

  if owners <> 2 then
    raise exception 'Both steps have to be your own.'
      using errcode = 'foreign_key_violation';
  end if;

  with recursive chain as (
    select depends_on_id as id, 1 as depth
      from plan_dependencies
     where item_id = new.depends_on_id
    union all
    select d.depends_on_id, chain.depth + 1
      from plan_dependencies d
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

drop trigger if exists plan_dependencies_check on plan_dependencies;
create trigger plan_dependencies_check
  before insert or update on plan_dependencies
  for each row execute function public.plan_dependencies_check();

alter table plan_dependencies enable row level security;

drop policy if exists plan_dependencies_select on plan_dependencies;
create policy plan_dependencies_select on plan_dependencies for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists plan_dependencies_insert on plan_dependencies;
create policy plan_dependencies_insert on plan_dependencies for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists plan_dependencies_update on plan_dependencies;
create policy plan_dependencies_update on plan_dependencies for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists plan_dependencies_delete on plan_dependencies;
create policy plan_dependencies_delete on plan_dependencies for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud, as 0050 and 0051 do and for the reason 0050 gives.
grant select, insert, update, delete on plan_dependencies to authenticated;

revoke all on table plan_dependencies from anon;
