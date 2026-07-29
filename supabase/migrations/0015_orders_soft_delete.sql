-- Soft-delete orders so they (and their inventory) can be restored later.
-- Active lists ignore deleted_at IS NOT NULL; Settings shows the trash.

alter table orders
  add column if not exists deleted_at timestamptz;

create index if not exists orders_user_deleted_idx
  on orders (user_id, deleted_at)
  where deleted_at is not null;

create index if not exists orders_user_active_date_idx
  on orders (user_id, order_date desc)
  where deleted_at is null;

-- Soft-deleted rows must not block re-import of the same order number.
drop index if exists orders_external_number_key;
create unique index orders_external_number_key
  on orders (user_id, merchant_id, external_order_number)
  where external_order_number is not null and deleted_at is null;
