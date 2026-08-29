-- Board games on the sell assistant.
--
-- The assistant was built for books and only ever looked at book_details, which
-- is why a shelf of 35 games showed an empty page. Games need their own price
-- cache because they have no ISBN: book_price_quotes is keyed (isbn_13, source)
-- with isbn_13 not null, and every owned game here resolved to a BGG id, so
-- that is the identity to cache against.
--
-- Deliberately a new table rather than a generalised one. Renaming
-- book_price_quotes would break whatever revision is currently deployed the
-- moment this runs, and the freshness rule the two share already lives in one
-- place in the application (lib/sell/quote-cache.ts), so the duplication here
-- is a table definition, not a policy.

-- The enum is named for books but its values -- buyback, ebay_browse,
-- sold_comps, web_estimate -- describe where a price came from, not what was
-- priced. Reused rather than cloned. ('buyback' goes unused for games: no
-- vendor buys board games back the way BookScouter buys textbooks.)
create table if not exists game_price_quotes (
  id uuid primary key default gen_random_uuid(),
  bgg_id integer not null,
  source book_price_quote_source not null,
  quoted_cents integer,
  shipping_cents integer not null default 0,
  vendor_name text,
  vendor_url text,
  payload jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_price_quotes_quoted_cents_ck
    check (quoted_cents is null or quoted_cents >= 0),
  constraint game_price_quotes_shipping_cents_ck
    check (shipping_cents >= 0)
);

create unique index if not exists game_price_quotes_bgg_source_key
  on game_price_quotes (bgg_id, source);

create index if not exists game_price_quotes_fetched_at_idx
  on game_price_quotes (fetched_at);

create trigger game_price_quotes_touch_updated_at
  before update on game_price_quotes
  for each row execute function public.touch_updated_at();

-- Shared reference cache, exactly as for books: a game's going rate is not
-- anyone's private data, so every authenticated user may read and refresh it.
-- Nothing here is joined to a user.
alter table game_price_quotes enable row level security;

create policy game_price_quotes_select on game_price_quotes for select to authenticated
  using (true);
create policy game_price_quotes_insert on game_price_quotes for insert to authenticated
  with check (true);
create policy game_price_quotes_update on game_price_quotes for update to authenticated
  using (true) with check (true);
create policy game_price_quotes_delete on game_price_quotes for delete to authenticated
  using (true);

grant select, insert, update, delete on game_price_quotes to authenticated;

-- Parity with book_details: a price you type yourself beats every lookup, and
-- for games it matters more, because a title search is a far weaker signal than
-- an ISBN and comes back empty more often.
alter table game_details
  add column if not exists manual_expected_price_cents integer;

alter table game_details
  drop constraint if exists game_details_manual_price_ck;
alter table game_details
  add constraint game_details_manual_price_ck
    check (manual_expected_price_cents is null or manual_expected_price_cents >= 0);
