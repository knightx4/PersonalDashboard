-- Books-first owned inventory + sell assistant foundation.
--
-- Extends order_source with photo capture, adds inventory_items.source so
-- standalone (non-order) units still carry provenance, and introduces
-- book_details as the first per-category detail table.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
alter type order_source add value if not exists 'photo';

do $$ begin
  create type book_condition as enum (
    'new',
    'like_new',
    'very_good',
    'good',
    'acceptable'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type book_resolution_source as enum (
    'google_books',
    'open_library',
    'isbndb',
    'manual'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type book_price_quote_source as enum (
    'buyback',
    'ebay_browse',
    'sold_comps'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- inventory_items.source
-- ---------------------------------------------------------------------------
alter table inventory_items
  add column if not exists source order_source;

-- Backfill from parent order when present; otherwise manual.
update inventory_items ii
set source = coalesce(
  (select o.source from order_items oi join orders o on o.id = oi.order_id where oi.id = ii.order_item_id),
  'manual'::order_source
)
where ii.source is null;

alter table inventory_items
  alter column source set default 'manual'::order_source;

alter table inventory_items
  alter column source set not null;

-- ---------------------------------------------------------------------------
-- profiles sell settings
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists sell_net_floor_cents integer;

alter table profiles
  add column if not exists sell_effort_cents integer not null default 500;

alter table profiles
  drop constraint if exists profiles_sell_net_floor_cents_ck;
alter table profiles
  add constraint profiles_sell_net_floor_cents_ck
  check (sell_net_floor_cents is null or sell_net_floor_cents >= 0);

alter table profiles
  drop constraint if exists profiles_sell_effort_cents_ck;
alter table profiles
  add constraint profiles_sell_effort_cents_ck
  check (sell_effort_cents >= 0);

-- ---------------------------------------------------------------------------
-- book_details
-- ---------------------------------------------------------------------------
create table if not exists book_details (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id) on delete cascade,
  isbn_13 text,
  isbn_10 text,
  authors text[] not null default '{}',
  edition text,
  publisher text,
  published_year integer,
  weight_grams integer,
  condition book_condition,
  resolution_source book_resolution_source not null default 'manual',
  match_confidence numeric(4, 3),
  needs_confirmation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_details_inventory_item_id_key unique (inventory_item_id),
  constraint book_details_published_year_ck
    check (published_year is null or (published_year >= 1000 and published_year <= 2100)),
  constraint book_details_weight_grams_ck
    check (weight_grams is null or weight_grams > 0),
  constraint book_details_match_confidence_ck
    check (
      match_confidence is null
      or (match_confidence >= 0 and match_confidence <= 1)
    )
);

create index if not exists book_details_isbn_13_idx on book_details (isbn_13)
  where isbn_13 is not null;

create trigger book_details_touch_updated_at
  before update on book_details
  for each row execute function public.touch_updated_at();

alter table book_details enable row level security;

create policy book_details_select on book_details for select to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
create policy book_details_insert on book_details for insert to authenticated
  with check (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
create policy book_details_update on book_details for update to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
create policy book_details_delete on book_details for delete to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on book_details to authenticated;

-- ---------------------------------------------------------------------------
-- book_price_quotes (cache for buyback / browse / later sold comps)
-- ---------------------------------------------------------------------------
create table if not exists book_price_quotes (
  id uuid primary key default gen_random_uuid(),
  isbn_13 text not null,
  source book_price_quote_source not null,
  quoted_cents integer,
  shipping_cents integer not null default 0,
  vendor_name text,
  vendor_url text,
  payload jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_price_quotes_quoted_cents_ck
    check (quoted_cents is null or quoted_cents >= 0),
  constraint book_price_quotes_shipping_cents_ck
    check (shipping_cents >= 0)
);

create unique index if not exists book_price_quotes_isbn_source_key
  on book_price_quotes (isbn_13, source);

create index if not exists book_price_quotes_fetched_at_idx
  on book_price_quotes (fetched_at);

create trigger book_price_quotes_touch_updated_at
  before update on book_price_quotes
  for each row execute function public.touch_updated_at();

-- Shared reference cache: every authenticated user may read; writes go through
-- server actions with the user session (or service role in jobs).
alter table book_price_quotes enable row level security;

create policy book_price_quotes_select on book_price_quotes for select to authenticated
  using (true);
create policy book_price_quotes_insert on book_price_quotes for insert to authenticated
  with check (true);
create policy book_price_quotes_update on book_price_quotes for update to authenticated
  using (true) with check (true);
create policy book_price_quotes_delete on book_price_quotes for delete to authenticated
  using (true);

grant select, insert, update, delete on book_price_quotes to authenticated;
