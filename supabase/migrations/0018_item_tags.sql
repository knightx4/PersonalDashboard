-- User-facing item tags (e.g. "shoes") separate from high-level categories
-- (e.g. "clothing"). Tags attach to order lines and are filterable/searchable.

set search_path = public, extensions;

create table item_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_tags_name_len_ck check (char_length(trim(name)) between 1 and 40),
  constraint item_tags_slug_len_ck check (char_length(slug) between 1 and 40)
);

create unique index item_tags_user_slug_key on item_tags (user_id, slug);
create index item_tags_user_idx on item_tags (user_id);

create trigger item_tags_touch_updated_at
  before update on item_tags
  for each row execute function public.touch_updated_at();

create table order_item_tags (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items (id) on delete cascade,
  tag_id uuid not null references item_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id, tag_id)
);

create index order_item_tags_item_idx on order_item_tags (order_item_id);
create index order_item_tags_tag_idx on order_item_tags (tag_id);

create trigger order_item_tags_touch_updated_at
  before update on order_item_tags
  for each row execute function public.touch_updated_at();

alter table item_tags enable row level security;
alter table order_item_tags enable row level security;

grant select, insert, update, delete on table item_tags to authenticated;
grant select, insert, update, delete on table order_item_tags to authenticated;

create policy item_tags_select on item_tags for select to authenticated
  using (user_id = (select auth.uid()));
create policy item_tags_insert on item_tags for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy item_tags_update on item_tags for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy item_tags_delete on item_tags for delete to authenticated
  using (user_id = (select auth.uid()));

create policy order_item_tags_select on order_item_tags for select to authenticated
  using (
    exists (
      select 1 from item_tags t
      where t.id = tag_id and t.user_id = (select auth.uid())
    )
  );
create policy order_item_tags_insert on order_item_tags for insert to authenticated
  with check (
    exists (
      select 1 from item_tags t
      where t.id = tag_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from order_items oi
      join orders o on o.id = oi.order_id
      where oi.id = order_item_id and o.user_id = (select auth.uid())
    )
  );
create policy order_item_tags_update on order_item_tags for update to authenticated
  using (
    exists (
      select 1 from item_tags t
      where t.id = tag_id and t.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from item_tags t
      where t.id = tag_id and t.user_id = (select auth.uid())
    )
  );
create policy order_item_tags_delete on order_item_tags for delete to authenticated
  using (
    exists (
      select 1 from item_tags t
      where t.id = tag_id and t.user_id = (select auth.uid())
    )
  );
