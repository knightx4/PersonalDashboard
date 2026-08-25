-- Give “confirm this is the right edition” something to show.
--
-- The resolver knows which other editions were plausible and why it hedged;
-- until now none of that reached the row, so the confirm prompt was a bare
-- yes/no. Stores the runner-up editions and the hedge reason, plus how the
-- row was created (manual capture vs. auto-import from an order email).

set search_path = public, extensions;

alter table book_details
  add column if not exists candidates jsonb not null default '[]'::jsonb;

alter table book_details
  add column if not exists confirmation_reason text;

alter table book_details
  add column if not exists auto_imported boolean not null default false;

alter table book_details
  drop constraint if exists book_details_candidates_is_array_ck;
alter table book_details
  add constraint book_details_candidates_is_array_ck
  check (jsonb_typeof(candidates) = 'array');

-- Backfill scan (“find books in my existing orders”) walks owned items by
-- category, so keep that lookup cheap.
create index if not exists inventory_user_category_status_idx
  on inventory_items (user_id, category_id, status);
