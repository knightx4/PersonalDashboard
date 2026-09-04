-- "Mark this for sale", for anything you own.
--
-- The sell assistant is built on the two detail tables that can be matched
-- against a catalog: book_details and game_details. That is the right basis
-- for routing — the router needs a price, and a price needs an identity —
-- but it means an item the app cannot look up has no way of reaching the
-- page at all, however much the user wants to sell it.
--
-- This flag is the user's own intent, kept apart from anything a lookup
-- decided. It carries no price and no routing: an item marked here appears
-- on the sell page as something to deal with, and books and games keep their
-- routed sections exactly as before. return_planned is the same idea for the
-- returns tracker, and this deliberately mirrors it.

set search_path = public, extensions;

alter table inventory_items
  add column if not exists for_sale boolean not null default false;

-- The sell page asks one question of this column: which of my owned items are
-- flagged? Partial, because the answer is a handful of rows out of everything
-- the user has ever bought.
create index if not exists inventory_items_for_sale_idx
  on inventory_items (user_id)
  where for_sale;
