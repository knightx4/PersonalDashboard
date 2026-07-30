-- Allow undoing a return: when the refunded returns row is deleted,
-- sync_order_state restores the unit to owned. Still the only writer of
-- inventory_items.status = 'returned' / back to 'owned' for return state.

set search_path = public, extensions;

create or replace function public.sync_order_state(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_merchant_id uuid;
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

  select o.user_id, o.merchant_id, o.cancelled_at
    into v_user_id, v_merchant_id, v_cancelled_at
  from orders o
  where o.id = p_order_id;

  if not found then
    return;
  end if;

  v_window := public.effective_return_window_days(v_user_id, v_merchant_id);

  -- 1. Returns are the source of truth for item state. A refunded return
  --    marks its linked unit returned; removing that return restores owned.
  update inventory_items ii
     set status = 'returned',
         return_planned = false
   from returns r
  where r.inventory_item_id = ii.id
    and r.order_id = p_order_id
    and r.status = 'refunded'
    and ii.status <> 'returned';

  update inventory_items ii
     set status = 'owned'
   where ii.status = 'returned'
     and ii.order_item_id in (
       select oi.id from order_items oi where oi.order_id = p_order_id
     )
     and not exists (
       select 1
         from returns r
        where r.inventory_item_id = ii.id
          and r.status = 'refunded'
     );

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

revoke all on function public.sync_order_state(uuid) from public, anon, authenticated;
