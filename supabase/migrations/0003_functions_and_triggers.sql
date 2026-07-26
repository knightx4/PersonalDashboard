-- Functions and triggers.
--
-- The important one is sync_order_state(): the single owner of derived order
-- and inventory status. Writing status by hand from several code paths
-- guarantees it drifts out of sync with reality, so no other code path may
-- assign orders.status or set inventory_items.status = 'returned'.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'categories', 'merchants', 'email_accounts', 'orders',
    'order_items', 'inventory_items', 'item_uses', 'shipments', 'returns',
    'saved_items', 'price_checks', 'ingested_messages', 'sync_jobs'
  ] loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles are created by trigger, never by application code.
-- App data never goes on auth.users directly.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- sync_order_state: the one function that owns derived status.
--
--   cancelled            order was cancelled
--   returned             every inventory_item is 'returned'
--   partially_returned   some but not all are
--   delivered            all shipments delivered
--   shipped              any shipment has shipped
--   ordered              otherwise
--
-- Also refreshes return_deadline (delivery date + the merchant's seeded
-- window; null when the merchant has no seeded window, because a wrong
-- return deadline is worse than no return deadline).
-- ---------------------------------------------------------------------------
create or replace function public.sync_order_state(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled_at timestamptz;
  v_total_items int;
  v_returned_items int;
  v_shipment_count int;
  v_delivered_count int;
  v_shipped_count int;
  v_delivered_at timestamptz;
  v_window int;
  v_status order_status;
begin
  if p_order_id is null then
    return;
  end if;

  select o.cancelled_at, m.default_return_window_days
    into v_cancelled_at, v_window
  from orders o
  left join merchants m on m.id = o.merchant_id
  where o.id = p_order_id;

  if not found then
    return;
  end if;

  -- 1. Returns are the source of truth for item state. A refunded return
  --    marks its linked unit returned; nothing else writes that value.
  update inventory_items ii
     set status = 'returned'
   from returns r
  where r.inventory_item_id = ii.id
    and r.order_id = p_order_id
    and r.status = 'refunded'
    and ii.status <> 'returned';

  -- 2. Roll item and shipment state up into the order.
  select count(*), count(*) filter (where ii.status = 'returned')
    into v_total_items, v_returned_items
  from inventory_items ii
  join order_items oi on oi.id = ii.order_item_id
  where oi.order_id = p_order_id;

  select count(*),
         count(*) filter (where s.status = 'delivered'),
         count(*) filter (where s.status <> 'pending'),
         max(s.delivered_at)
    into v_shipment_count, v_delivered_count, v_shipped_count, v_delivered_at
  from shipments s
  where s.order_id = p_order_id;

  if v_cancelled_at is not null then
    v_status := 'cancelled';
  elsif v_total_items > 0 and v_returned_items = v_total_items then
    v_status := 'returned';
  elsif v_returned_items > 0 then
    v_status := 'partially_returned';
  elsif v_shipment_count > 0 and v_delivered_count = v_shipment_count then
    v_status := 'delivered';
  elsif v_shipped_count > 0 then
    v_status := 'shipped';
  else
    v_status := 'ordered';
  end if;

  update orders
     set status = v_status,
         return_deadline = case
           when v_window is null or v_delivered_at is null then null
           else (v_delivered_at at time zone 'utc')::date + v_window
         end
   where id = p_order_id;
end;
$$;

-- Fire it on any change that can affect the derivation.
create or replace function public.sync_order_state_from_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  v_order_id := case tg_op when 'DELETE' then old.order_id else new.order_id end;
  perform public.sync_order_state(v_order_id);
  return null;
end;
$$;

create trigger shipments_sync_order_state
  after insert or update or delete on shipments
  for each row execute function public.sync_order_state_from_child();

create trigger returns_sync_order_state
  after insert or update or delete on returns
  for each row execute function public.sync_order_state_from_child();

-- inventory_items reaches its order through order_items
create or replace function public.sync_order_state_from_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_item_id uuid;
  v_order_id uuid;
begin
  v_order_item_id := case tg_op
    when 'DELETE' then old.order_item_id else new.order_item_id end;
  if v_order_item_id is null then
    return null;
  end if;
  select order_id into v_order_id from order_items where id = v_order_item_id;
  perform public.sync_order_state(v_order_id);
  return null;
end;
$$;

create trigger inventory_sync_order_state
  after insert or delete or update of status, order_item_id on inventory_items
  for each row execute function public.sync_order_state_from_inventory();

-- Cancelling an order (or repointing it at a merchant with a different return
-- window) also has to re-derive.
create or replace function public.sync_order_state_self()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_order_state(new.id);
  return null;
end;
$$;

create trigger orders_sync_order_state
  after insert or update of cancelled_at, merchant_id on orders
  for each row execute function public.sync_order_state_self();
