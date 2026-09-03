-- Structured details on an item, and a per-category template that says which
-- details an item of that kind should carry.
--
-- A board game wants players, playing time and a BoardGameGeek link; a book
-- wants ISBN and genre; a shirt wants brand and size. Detail tables already
-- exist for the two categories the app can resolve automatically
-- (book_details, game_details), and they stay: they hold identity, which is
-- matched against a catalog and drives pricing. This is the other half —
-- whatever the user wants to record, on any category, without a migration per
-- field.
--
-- Values live in a jsonb bag on the item rather than a row per field: they are
-- always read as a whole item, never queried across items, and a bag keeps a
-- value that has outlived its template field instead of orphaning it.
--
-- The template is per user and per category, so editing it changes what every
-- item in that category shows. Built-in defaults for the common categories
-- live in lib/inventory/attributes.ts and need no row here; a row is written
-- only once the user edits the template, and then it wins.

set search_path = public, extensions;

alter table inventory_items
  add column if not exists attributes jsonb not null default '{}'::jsonb;

alter table inventory_items
  drop constraint if exists inventory_items_attributes_object_ck;
alter table inventory_items
  add constraint inventory_items_attributes_object_ck
  check (jsonb_typeof(attributes) = 'object');

create table if not exists category_attribute_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  -- [{ "key": "players", "label": "Players", "type": "text" }, …]
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id),
  constraint category_attribute_templates_fields_array_ck
    check (jsonb_typeof(fields) = 'array')
);

create index if not exists category_attribute_templates_user_idx
  on category_attribute_templates (user_id);

alter table category_attribute_templates enable row level security;

drop policy if exists category_attribute_templates_all on category_attribute_templates;
create policy category_attribute_templates_all on category_attribute_templates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists category_attribute_templates_touch_updated_at
  on category_attribute_templates;
create trigger category_attribute_templates_touch_updated_at
  before update on category_attribute_templates
  for each row execute function public.touch_updated_at();
