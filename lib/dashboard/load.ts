import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  allocateLandedCost,
  periodFor,
  previousPeriodFor,
  spend,
  spendByCategory,
  spendByMerchant,
  todayInTimezone,
  valueOwned,
  type CategorizedUnit,
  type CategorySpendSlice,
  type MerchantSpendOrder,
  type MerchantSpendSlice,
  type Period,
  type PresetRange,
  type SpendBreakdown,
  type SpendOrder,
  type SpendRefund,
} from '@/lib/money';

export const DASHBOARD_RANGES: { id: PresetRange; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3_months', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_12_months', label: 'Last 12 months' },
];

export function parseDashboardRange(raw: string | undefined): PresetRange {
  return DASHBOARD_RANGES.find((entry) => entry.id === raw)?.id ?? 'this_month';
}

export function dashboardHref(range: PresetRange): string {
  return `/dashboard?range=${range}`;
}

export interface ReturnableRow {
  inventoryItemId: string;
  name: string;
  orderId: string;
  merchantName: string;
  returnDeadline: string;
  daysLeft: number;
}

export interface DashboardData {
  timezone: string;
  today: string;
  range: PresetRange;
  period: Period;
  previousPeriod: Period;
  orderCount: number;
  currency: string;
  current: SpendBreakdown;
  previous: SpendBreakdown;
  categories: CategorySpendSlice[];
  merchants: MerchantSpendSlice[];
  valueOwnedCents: number;
  returnable: ReturnableRow[];
}

type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  parent_id: string | null;
};

type OrderRow = {
  id: string;
  order_date: string;
  subtotal_cents: number;
  tax_cents: number;
  shipping_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string;
  cancelled_at: string | null;
  status: string;
  return_deadline: string | null;
  merchant_id: string | null;
  merchants: { name: string } | { name: string }[] | null;
  order_items: OrderItemRow[] | OrderItemRow | null;
};

type OrderItemRow = {
  id: string;
  quantity: number;
  unit_price_cents: number;
  category_id: string | null;
};

type ReturnRow = {
  refunded_at: string | null;
  refund_amount_cents: number;
  status: string;
};

type InventoryRow = {
  id: string;
  name: string;
  cost_cents: number;
  status: string;
  order_item_id: string | null;
  order_items:
    | {
        order_id: string;
        orders:
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchants: { name: string } | { name: string }[] | null;
            }
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchants: { name: string } | { name: string }[] | null;
            }[]
          | null;
      }
    | {
        order_id: string;
        orders:
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchants: { name: string } | { name: string }[] | null;
            }
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchants: { name: string } | { name: string }[] | null;
            }[]
          | null;
      }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

function isCancelled(order: Pick<OrderRow, 'cancelled_at' | 'status'>): boolean {
  return order.cancelled_at != null || order.status === 'cancelled';
}

function toSpendOrders(orders: OrderRow[]): SpendOrder[] {
  return orders.map((order) => ({
    orderDate: order.order_date,
    totalCents: order.total_cents,
    cancelled: isCancelled(order),
  }));
}

function toSpendRefunds(returns: ReturnRow[]): SpendRefund[] {
  return returns.map((row) => ({
    refundedAt: row.refunded_at,
    refundAmountCents: row.refund_amount_cents,
    refunded: row.status === 'refunded',
  }));
}

function toMerchantOrders(orders: OrderRow[]): MerchantSpendOrder[] {
  return orders.map((order) => {
    const merchant = one(order.merchants);
    return {
      orderDate: order.order_date,
      totalCents: order.total_cents,
      cancelled: isCancelled(order),
      merchantId: order.merchant_id,
      merchantName: merchant?.name ?? null,
    };
  });
}

/** Map any category (including children) to its top-level ancestor for the donut. */
function topLevelCategory(
  categoryId: string | null,
  byId: Map<string, CategoryRow>,
): Pick<CategoryRow, 'id' | 'name' | 'color'> | null {
  if (!categoryId) return null;
  let current = byId.get(categoryId);
  if (!current) return null;
  while (current.parent_id) {
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function toCategorizedUnits(
  orders: OrderRow[],
  categories: Map<string, CategoryRow>,
): CategorizedUnit[] {
  const units: CategorizedUnit[] = [];

  for (const order of orders) {
    const cancelled = isCancelled(order);
    const items = Array.isArray(order.order_items)
      ? order.order_items
      : order.order_items
        ? [order.order_items]
        : [];

    if (items.length === 0) continue;

    const allocated = allocateLandedCost(
      items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
      })),
      {
        subtotalCents: order.subtotal_cents,
        taxCents: order.tax_cents,
        shippingCents: order.shipping_cents,
        discountCents: order.discount_cents,
        totalCents: order.total_cents,
      },
    );

    const byItem = new Map(items.map((item) => [item.id, item]));
    for (const unit of allocated) {
      const item = byItem.get(unit.orderItemId);
      if (!item) continue;
      const top = topLevelCategory(item.category_id, categories);
      units.push({
        orderDate: order.order_date,
        cancelled,
        costCents: unit.costCents,
        categoryId: top?.id ?? null,
        categoryName: top?.name ?? null,
        categoryColor: top?.color ?? null,
      });
    }
  }

  return units;
}

function returnableFromInventory(
  items: InventoryRow[],
  today: string,
): ReturnableRow[] {
  const rows: ReturnableRow[] = [];

  for (const item of items) {
    if (item.status !== 'owned') continue;
    const orderItem = one(item.order_items);
    const order = one(orderItem?.orders);
    if (!order?.return_deadline) continue;
    if (order.return_deadline < today) continue;
    if (order.status === 'cancelled' || order.status === 'returned') continue;

    const merchant = one(order.merchants);
    rows.push({
      inventoryItemId: item.id,
      name: item.name,
      orderId: order.id,
      merchantName: merchant?.name ?? 'Unknown merchant',
      returnDeadline: order.return_deadline,
      daysLeft: daysBetween(today, order.return_deadline),
    });
  }

  return rows.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name),
  );
}

/**
 * Load every figure the dashboard needs. All aggregation goes through
 * lib/money.ts; this file only fetches and shapes rows.
 */
export async function loadDashboard(
  supabase: SupabaseClient,
  userId: string,
  range: PresetRange,
): Promise<DashboardData> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();

  const timezone = profile?.timezone ?? 'UTC';
  const today = todayInTimezone(timezone);
  const period = periodFor(range, timezone);
  const previous = previousPeriodFor(range, timezone);

  // Window wide enough for current + previous comparisons. Returnable and
  // value-owned are stock metrics and ignore this window.
  const earliest = period.start < previous.start ? period.start : previous.start;
  const latest = period.end > previous.end ? period.end : previous.end;

  const [
    { count: orderCount },
    { data: categoryRows, error: categoriesError },
    { data: orderRows, error: ordersError },
    { data: returnRows, error: returnsError },
    { data: inventoryRows, error: inventoryError },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase.from('categories').select('id, name, color, parent_id'),
    supabase
      .from('orders')
      .select(
        `
        id, order_date, subtotal_cents, tax_cents, shipping_cents,
        discount_cents, total_cents, currency, cancelled_at, status,
        return_deadline, merchant_id,
        merchants ( name ),
        order_items ( id, quantity, unit_price_cents, category_id )
      `,
      )
      .eq('user_id', userId)
      .gte('order_date', earliest)
      .lte('order_date', latest),
    supabase
      .from('returns')
      .select('refunded_at, refund_amount_cents, status')
      .eq('user_id', userId)
      .eq('status', 'refunded')
      .gte('refunded_at', earliest)
      .lte('refunded_at', latest),
    supabase
      .from('inventory_items')
      .select(
        `
        id, name, cost_cents, status, order_item_id,
        order_items (
          order_id,
          orders (
            id, status, return_deadline,
            merchants ( name )
          )
        )
      `,
      )
      .eq('user_id', userId),
  ]);

  if (categoriesError) throw categoriesError;
  if (ordersError) throw ordersError;
  if (returnsError) throw returnsError;
  if (inventoryError) throw inventoryError;

  const orders = (orderRows ?? []) as OrderRow[];
  const returns = (returnRows ?? []) as ReturnRow[];
  const inventory = (inventoryRows ?? []) as InventoryRow[];
  const categories = new Map(
    ((categoryRows ?? []) as CategoryRow[]).map((row) => [row.id, row]),
  );

  const spendOrders = toSpendOrders(orders);
  const spendRefunds = toSpendRefunds(returns);
  const current = spend(spendOrders, spendRefunds, period);
  const previousBreakdown = spend(spendOrders, spendRefunds, previous);

  const currency =
    orders.find((order) => order.order_date >= period.start && order.order_date <= period.end)
      ?.currency ??
    orders[0]?.currency ??
    'USD';

  return {
    timezone,
    today,
    range,
    period,
    previousPeriod: previous,
    orderCount: orderCount ?? 0,
    currency,
    current,
    previous: previousBreakdown,
    categories: spendByCategory(toCategorizedUnits(orders, categories), period),
    merchants: spendByMerchant(toMerchantOrders(orders), period),
    valueOwnedCents: valueOwned(
      inventory.map((item) => ({
        costCents: item.cost_cents,
        status: item.status,
      })),
    ),
    returnable: returnableFromInventory(inventory, today),
  };
}
