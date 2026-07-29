-- Short display names, search tags for smart inventory search, and Kitchen
-- as a top-level system category.

set search_path = public, extensions;

alter table order_items
  add column if not exists short_name text;

alter table inventory_items
  add column if not exists short_name text;

alter table inventory_items
  add column if not exists search_tags text[] not null default '{}';

create index if not exists inventory_short_name_trgm_idx
  on inventory_items using gin (short_name gin_trgm_ops);

create index if not exists inventory_search_tags_gin_idx
  on inventory_items using gin (search_tags);

-- Best-effort short names for existing rows until the app backfill runs.
update inventory_items
set short_name = left(name, 60)
where short_name is null;

update order_items
set short_name = left(name, 60)
where short_name is null;

insert into categories (user_id, parent_id, name, slug, color)
select null, null, 'Kitchen', 'kitchen', '#D97706'
where not exists (
  select 1 from categories where user_id is null and slug = 'kitchen'
);
