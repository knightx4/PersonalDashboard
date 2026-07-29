-- User-owned inventory lists (wishlists / trackers), separate from categories.
-- An item can belong to many lists; filtering on Inventory is by membership.

set search_path = public, extensions;

create table item_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index item_lists_user_slug_key on item_lists (user_id, slug);
create index item_lists_user_idx on item_lists (user_id);

create trigger item_lists_touch_updated_at
  before update on item_lists
  for each row execute function public.touch_updated_at();

create table inventory_item_lists (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id) on delete cascade,
  list_id uuid not null references item_lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, list_id)
);

create index inventory_item_lists_item_idx on inventory_item_lists (inventory_item_id);
create index inventory_item_lists_list_idx on inventory_item_lists (list_id);

create trigger inventory_item_lists_touch_updated_at
  before update on inventory_item_lists
  for each row execute function public.touch_updated_at();

alter table item_lists enable row level security;
alter table inventory_item_lists enable row level security;

create policy item_lists_select on item_lists for select to authenticated
  using (user_id = (select auth.uid()));
create policy item_lists_insert on item_lists for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy item_lists_update on item_lists for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy item_lists_delete on item_lists for delete to authenticated
  using (user_id = (select auth.uid()));

create policy inventory_item_lists_select on inventory_item_lists for select to authenticated
  using (
    exists (
      select 1 from item_lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  );
create policy inventory_item_lists_insert on inventory_item_lists for insert to authenticated
  with check (
    exists (
      select 1 from item_lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
    and exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
create policy inventory_item_lists_update on inventory_item_lists for update to authenticated
  using (
    exists (
      select 1 from item_lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from item_lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
    and exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
create policy inventory_item_lists_delete on inventory_item_lists for delete to authenticated
  using (
    exists (
      select 1 from item_lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on item_lists to authenticated;
grant select, insert, update, delete on inventory_item_lists to authenticated;
