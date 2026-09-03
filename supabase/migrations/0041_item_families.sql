-- Item families: which things belong together, and tags that reach inventory.
--
-- This is the grouping layer the shared form needs, and it lives on the
-- inventory rather than on the share, so a second share and the main inventory
-- page both get it. See docs/SHARE-LINKS-SPEC.md.
--
-- Two different questions, two mechanisms:
--
--   "are these the same thing?"  -> quantity, and that is a *computed* key
--                                   (lib/share/grouping.ts), not a table. It
--                                   is derived from a bgg id or a normalized
--                                   title, and a stored copy of a derived
--                                   value is a thing that can be wrong.
--
--   "do these belong together?"  -> this migration. All the Monopolies under
--                                   one heading, expansions under their base.

set search_path = public, extensions;

-- `role` is what makes this structurally sound rather than a folder: the form
-- can put base games first and the twelve themed editions beneath, and the
-- sell assistant can eventually know an expansion without its base is worth
-- less than one with it.
do $$ begin
  create type item_family_role as enum (
    'base', 'expansion', 'edition', 'accessory', 'member'
  );
exception when duplicate_object then null;
end $$;

-- Where a membership came from, so an automatic suggestion is never mistaken
-- for a decision a person made.
do $$ begin
  create type item_family_source as enum ('manual', 'bgg_link', 'title_cluster');
exception when duplicate_object then null;
end $$;

create table item_families (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_families_name_len_ck check (char_length(trim(name)) between 1 and 80),
  constraint item_families_slug_len_ck check (char_length(slug) between 1 and 80)
);

create unique index item_families_user_slug_key on item_families (user_id, slug);
create index item_families_user_idx on item_families (user_id);

create trigger item_families_touch_updated_at
  before update on item_families
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
--
-- **One family per item**, enforced by the unique index on inventory_item_id
-- alone rather than on the pair. A game is in the Monopoly family or it is
-- not; letting it be in two makes "which heading does this render under?" a
-- question with no answer, and the renderer would have to invent a
-- tie-break nobody asked for.
--
-- Three states, and the third is the one that is easy to forget:
--
--   suggested  confirmed_at null, rejected_at null
--   confirmed  confirmed_at set    -- a person said yes; the form groups on it
--   rejected   rejected_at set     -- a person said no, and it is a tombstone
--
-- Without the tombstone the suggester proposes "Ticket to Ride: Europe belongs
-- under Ticket to Ride" again on every run, forever, and rejecting it is not a
-- decision that sticks.
create table inventory_item_families (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id) on delete cascade,
  family_id uuid not null references item_families (id) on delete cascade,
  role item_family_role not null default 'member',
  source item_family_source not null default 'manual',
  position integer not null default 0,
  confidence numeric(4, 3),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_item_families_confidence_ck
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- A row cannot be both accepted and refused.
  constraint inventory_item_families_verdict_ck
    check (confirmed_at is null or rejected_at is null)
);

-- One live family per item. A rejected row is a tombstone, not a membership,
-- so it is excluded -- otherwise refusing one suggestion would block every
-- later one for that item.
create unique index inventory_item_families_one_live_key
  on inventory_item_families (inventory_item_id)
  where rejected_at is null;

-- The tombstone itself still has to be unique per pairing, or the suggester
-- writes a new refusal every run instead of finding the old one.
create unique index inventory_item_families_pair_key
  on inventory_item_families (inventory_item_id, family_id);

create index inventory_item_families_family_idx
  on inventory_item_families (family_id);
-- "the confirmed families for these items", which is what the form loads.
create index inventory_item_families_confirmed_idx
  on inventory_item_families (inventory_item_id, family_id)
  where confirmed_at is not null;

create trigger inventory_item_families_touch_updated_at
  before update on inventory_item_families
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tags that reach inventory
-- ---------------------------------------------------------------------------
--
-- 0018 gave `item_tags` a join to `order_items`, which is the wrong end for
-- this: a game added by scanning its barcode has no order line, so half the
-- shelf is untaggable and "everything tagged board-games" cannot be asked as
-- one query. This adds the join that was missing, reusing the same vocabulary
-- table rather than starting a second one.
--
-- This is the selector `addToShareByFilter` leans on, and the reason "put all
-- the heavy euros on the form" is expressible at all.
create table inventory_item_tags (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id) on delete cascade,
  tag_id uuid not null references item_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, tag_id)
);

create index inventory_item_tags_item_idx on inventory_item_tags (inventory_item_id);
create index inventory_item_tags_tag_idx on inventory_item_tags (tag_id);

create trigger inventory_item_tags_touch_updated_at
  before update on inventory_item_tags
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table item_families enable row level security;
alter table inventory_item_families enable row level security;
alter table inventory_item_tags enable row level security;

grant select, insert, update, delete on item_families to authenticated;
grant select, insert, update, delete on inventory_item_families to authenticated;
grant select, insert, update, delete on inventory_item_tags to authenticated;

create policy item_families_select on item_families for select to authenticated
  using (user_id = (select auth.uid()));
create policy item_families_insert on item_families for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy item_families_update on item_families for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy item_families_delete on item_families for delete to authenticated
  using (user_id = (select auth.uid()));

-- Both ends checked on insert, exactly as order_item_tags does in 0018: the
-- family is mine and so is the item. Checking only one end makes membership a
-- way to read across the boundary.
create policy inventory_item_families_select on inventory_item_families
  for select to authenticated
  using (exists (select 1 from item_families f
                  where f.id = family_id and f.user_id = (select auth.uid())));
create policy inventory_item_families_insert on inventory_item_families
  for insert to authenticated
  with check (
    exists (select 1 from item_families f
             where f.id = family_id and f.user_id = (select auth.uid()))
    and exists (select 1 from inventory_items i
                 where i.id = inventory_item_id and i.user_id = (select auth.uid()))
  );
create policy inventory_item_families_update on inventory_item_families
  for update to authenticated
  using (exists (select 1 from item_families f
                  where f.id = family_id and f.user_id = (select auth.uid())))
  with check (exists (select 1 from item_families f
                       where f.id = family_id and f.user_id = (select auth.uid())));
create policy inventory_item_families_delete on inventory_item_families
  for delete to authenticated
  using (exists (select 1 from item_families f
                  where f.id = family_id and f.user_id = (select auth.uid())));

create policy inventory_item_tags_select on inventory_item_tags
  for select to authenticated
  using (exists (select 1 from item_tags t
                  where t.id = tag_id and t.user_id = (select auth.uid())));
create policy inventory_item_tags_insert on inventory_item_tags
  for insert to authenticated
  with check (
    exists (select 1 from item_tags t
             where t.id = tag_id and t.user_id = (select auth.uid()))
    and exists (select 1 from inventory_items i
                 where i.id = inventory_item_id and i.user_id = (select auth.uid()))
  );
create policy inventory_item_tags_update on inventory_item_tags
  for update to authenticated
  using (exists (select 1 from item_tags t
                  where t.id = tag_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from item_tags t
                       where t.id = tag_id and t.user_id = (select auth.uid())));
create policy inventory_item_tags_delete on inventory_item_tags
  for delete to authenticated
  using (exists (select 1 from item_tags t
                  where t.id = tag_id and t.user_id = (select auth.uid())));
