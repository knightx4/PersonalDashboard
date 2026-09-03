-- Price anything you marked for sale, not just books and board games.
--
-- The sell assistant grew outward from book_details: a price needs an identity,
-- an identity meant an ISBN, and later a BGG id. That left the page organised by
-- what the catalog happened to recognise -- a books section, a games section,
-- and a third list of "marked for sale" rows that carried no price at all
-- because nothing could look them up.
--
-- The flag is the better organising idea: what the user marked for sale is what
-- they want to deal with, whatever it is. A title search already prices a board
-- game (lib/sell/expected-price.ts, expectedSelfListCentsFor), and a title is
-- exactly as good a query for a blender as it is for Catan. So the missing
-- piece is not a lookup, it is somewhere to keep the answer for an item that has
-- neither ISBN nor BGG id.
--
-- Two additions, both narrow:
--
--   item_price_quotes  the quote cache keyed by the item itself. Unlike the ISBN
--                      and BGG caches this is NOT shared market data -- "the
--                      going rate for the thing Alice calls 'grey desk lamp'"
--                      only means something to Alice -- so it is user-scoped
--                      through inventory_items, like book_details.
--
--   inventory_items.manual_expected_price_cents
--                      the price you type yourself, for an item with no detail
--                      row to hold it. Books and games keep their own column;
--                      an item has at most one of the three.

set search_path = public, extensions;

-- The enum is named for books but its values name where a price came from, not
-- what was priced -- reused here for the same reason 0030 reused it for games.
-- ('buyback' goes unused: no vendor buys a lamp back sight-unseen.)
create table if not exists item_price_quotes (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null
    references inventory_items (id) on delete cascade,
  source book_price_quote_source not null,
  quoted_cents integer,
  shipping_cents integer not null default 0,
  vendor_name text,
  vendor_url text,
  payload jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_price_quotes_quoted_cents_ck
    check (quoted_cents is null or quoted_cents >= 0),
  constraint item_price_quotes_shipping_cents_ck
    check (shipping_cents >= 0)
);

create unique index if not exists item_price_quotes_item_source_key
  on item_price_quotes (inventory_item_id, source);

create index if not exists item_price_quotes_fetched_at_idx
  on item_price_quotes (fetched_at);

drop trigger if exists item_price_quotes_touch_updated_at on item_price_quotes;
create trigger item_price_quotes_touch_updated_at
  before update on item_price_quotes
  for each row execute function public.touch_updated_at();

-- Ownership is the item's, exactly as for book_details: nothing in this table
-- is reference data, so nobody else may read a row of it.
alter table item_price_quotes enable row level security;

drop policy if exists item_price_quotes_select on item_price_quotes;
create policy item_price_quotes_select on item_price_quotes for select to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );

drop policy if exists item_price_quotes_insert on item_price_quotes;
create policy item_price_quotes_insert on item_price_quotes for insert to authenticated
  with check (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );

drop policy if exists item_price_quotes_update on item_price_quotes;
create policy item_price_quotes_update on item_price_quotes for update to authenticated
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

drop policy if exists item_price_quotes_delete on item_price_quotes;
create policy item_price_quotes_delete on item_price_quotes for delete to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on item_price_quotes to authenticated;

-- Parity with book_details and game_details: a price you typed beats every
-- lookup. This column is read only for items that have neither detail row, so
-- there is never a question of which of the three wins.
alter table inventory_items
  add column if not exists manual_expected_price_cents integer;

alter table inventory_items
  drop constraint if exists inventory_items_manual_price_ck;
alter table inventory_items
  add constraint inventory_items_manual_price_ck
    check (manual_expected_price_cents is null or manual_expected_price_cents >= 0);
