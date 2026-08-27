-- A price you looked up yourself beats any estimate, and costs nothing.
-- Set on the item, it wins over eBay and over web estimates in the router.

set search_path = public, extensions;

alter table book_details
  add column if not exists manual_expected_price_cents integer;

alter table book_details
  drop constraint if exists book_details_manual_price_ck;
alter table book_details
  add constraint book_details_manual_price_ck
  check (manual_expected_price_cents is null or manual_expected_price_cents >= 0);
