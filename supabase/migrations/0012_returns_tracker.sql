-- Returns tracker: per-user merchant return-window overrides, planned-return
-- flag on inventory, and sync_order_state that prefers the override.
--
-- Global merchants stay read-only. A wrong deadline is still worse than none:
-- overrides are explicit user choices; null clears back to the seeded default
-- (or to no window when the seed has none).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- inventory: mark an owned unit as something you intend to return
-- ---------------------------------------------------------------------------
alter table inventory_items
  add column return_planned boolean not null default false;

create index inventory_return_planned_idx
  on inventory_items (user_id)
  where return_planned and status = 'owned';

-- ---------------------------------------------------------------------------
-- merchant_return_policies — user overrides of merchants.default_return_window_days
-- ---------------------------------------------------------------------------
create table merchant_return_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_id uuid not null references merchants (id) on delete cascade,
  -- null means "no return window for me" (hides deadlines), distinct from
  -- deleting the row which restores the merchant's seeded default.
  return_window_days int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_return_policies_window_ck check (
    return_window_days is null or return_window_days between 1 and 730
  )
);

create unique index merchant_return_policies_user_merchant_uidx
  on merchant_return_policies (user_id, merchant_id);

create index merchant_return_policies_user_idx
  on merchant_return_policies (user_id);

create trigger merchant_return_policies_touch_updated_at
  before update on merchant_return_policies
  for each row execute function public.touch_updated_at();

alter table merchant_return_policies enable row level security;

create policy merchant_return_policies_select on merchant_return_policies
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy merchant_return_policies_insert on merchant_return_policies
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy merchant_return_policies_update on merchant_return_policies
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy merchant_return_policies_delete on merchant_return_policies
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on merchant_return_policies to authenticated;

-- ---------------------------------------------------------------------------
-- Effective window: override row wins (even when its days are null); else seed.
-- ---------------------------------------------------------------------------
create or replace function public.effective_return_window_days(
  p_user_id uuid,
  p_merchant_id uuid
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from merchant_return_policies p
      where p.user_id = p_user_id and p.merchant_id = p_merchant_id
    ) then (
      select p.return_window_days
      from merchant_return_policies p
      where p.user_id = p_user_id and p.merchant_id = p_merchant_id
    )
    else (
      select m.default_return_window_days
      from merchants m
      where m.id = p_merchant_id
    )
  end;
$$;

revoke all on function public.effective_return_window_days(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- sync_order_state: prefer the user's override when computing return_deadline
-- ---------------------------------------------------------------------------
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
  --    marks its linked unit returned; nothing else writes that value.
  update inventory_items ii
     set status = 'returned',
         return_planned = false
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

revoke all on function public.sync_order_state(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-derive deadlines when a user changes a merchant's return window
-- ---------------------------------------------------------------------------
create or replace function public.sync_orders_for_return_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_merchant_id uuid;
  r record;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_merchant_id := old.merchant_id;
  else
    v_user_id := new.user_id;
    v_merchant_id := new.merchant_id;
  end if;

  for r in
    select id from orders
     where user_id = v_user_id
       and merchant_id = v_merchant_id
  loop
    perform public.sync_order_state(r.id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_orders_for_return_policy()
  from public, anon, authenticated;

create trigger merchant_return_policies_sync_orders
  after insert or update or delete on merchant_return_policies
  for each row execute function public.sync_orders_for_return_policy();
