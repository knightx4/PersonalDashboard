-- Three copies of Acquire are one item you own three of, not three items.
--
-- `inventory_items` is one row per physical unit and stays that way: returns,
-- disposal and per-unit landed cost are all trivial because of it, and the
-- moment a quantity column exists every one of those queries grows arithmetic.
-- What was missing is the layer above -- the *product* -- so the list can show
-- one row with a quantity on it and the page behind it can talk about the item
-- rather than about one box of it.
--
-- Half of that layer already exists and is not a table: lib/share/grouping.ts
-- derives a key ("game:bgg:5", "item:fp:...") that says which units are the
-- same thing, and the shared form has counted quantities with it for a while.
-- Deriving is the right default -- a copy bought next month stacks with no
-- one doing anything, and there is no stored value to go stale.
--
-- What deriving cannot do is take an instruction. "These two are the same
-- thing even though the titles differ" and "this one is NOT one of those" are
-- decisions, and a decision has to be written down. Hence this table, and
-- hence the rule the reader should carry away:
--
--   inventory_items.group_id IS NULL   stack by the derived key (the default)
--   inventory_items.group_id IS SET    a person said so; the key does not vote
--
-- So there is no backfill here, and deliberately: every unit starts NULL and
-- goes on stacking exactly as the share form already stacks it. A row appears
-- in this table only when somebody merges or splits, which is also what makes
-- both reversible -- clearing group_id hands the unit back to the derivation.
--
-- `group_key` is how an explicit group keeps absorbing new arrivals: a group
-- made by merging three Acquires remembers the key those units derive to, so
-- a fourth Acquire bought later joins it rather than forming a second stack
-- beside it. A group holding a unit somebody split off has no key -- that is
-- the whole point of splitting it -- and NULL is therefore meaningful, which
-- is why the uniqueness index below is partial.

set search_path = public, extensions;

create table if not exists item_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What to call the stack. Seeded from the units at merge time and editable,
  -- because "the item" having a name of its own is the point.
  name text not null,
  -- The derived key this group stands in for, or NULL for a group that exists
  -- only to hold units held out of one. See lib/share/grouping.ts.
  group_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_groups_name_len_ck
    check (char_length(trim(name)) between 1 and 200),
  constraint item_groups_key_len_ck
    check (group_key is null or char_length(group_key) between 1 and 200)
);

-- One group per key per user: two explicit groups claiming the same derived
-- key would leave "which one does a new copy join?" unanswerable. Partial, so
-- any number of keyless split-off groups can coexist.
create unique index if not exists item_groups_user_key_key
  on item_groups (user_id, group_key)
  where group_key is not null;

create index if not exists item_groups_user_idx on item_groups (user_id);

drop trigger if exists item_groups_touch_updated_at on item_groups;
create trigger item_groups_touch_updated_at
  before update on item_groups
  for each row execute function public.touch_updated_at();

-- `on delete set null` rather than cascade: deleting the grouping must never
-- delete the things grouped. A unit whose group goes away is simply back to
-- being stacked by its derived key.
alter table inventory_items
  add column if not exists group_id uuid references item_groups (id) on delete set null;

-- The list reads every owned unit and folds it into its group, so this index
-- earns its keep on the main query -- and an unindexed foreign key also makes
-- deleting a group scan the whole table.
create index if not exists inventory_items_group_idx
  on inventory_items (group_id)
  where group_id is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Ownership is direct, so no join: `user_id` is on the row. `(select
-- auth.uid())` rather than a bare call, so the planner evaluates it once for
-- the statement instead of once per row.
alter table item_groups enable row level security;

drop policy if exists item_groups_select on item_groups;
create policy item_groups_select on item_groups for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists item_groups_insert on item_groups;
create policy item_groups_insert on item_groups for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists item_groups_update on item_groups;
create policy item_groups_update on item_groups for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists item_groups_delete on item_groups;
create policy item_groups_delete on item_groups for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on item_groups to authenticated;
