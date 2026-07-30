import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  convertToDisplayCents,
  loadDisplayCurrency,
} from '@/lib/fx/display';
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
  orders:
    | { currency: string; order_date: string; deleted_at: string | null }
    | { currency: string; order_date: string; deleted_at: string | null }[]
    | null;
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
              deleted_at: string | null;
              currency: string;
              order_date: string;
              merchants: { name: string } | { name: string }[] | null;
            }
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              deleted_at: string | null;
              currency: string;
              order_date: string;
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
              deleted_at: string | null;
              currency: string;
              order_date: string;
              merchants: { name: string } | { name: string }[] | null;
            }
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              deleted_at: string | null;
              currency: string;
              order_date: string;
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
  // Local helper kept here so dashboard load stays free of returns-module coupling
  // for this stock metric; tracker UI uses lib/returns/deadline.ts.
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
    if (order?.deleted_at) continue;
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
 *
 * Mixed-currency orders are converted to the user's display_currency using
 * Frankfurter rates on each order's purchase date before aggregation.
 */
export async function loadDashboard(
  supabase: SupabaseClient,
  userId: string,
  range: PresetRange,
): Promise<DashboardData> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone, display_currency')
    .eq('id', userId)
    .single();

  const timezone = profile?.timezone ?? 'UTC';
  const displayCurrency = await loadDisplayCurrency(supabase, userId);
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
      .eq('user_id', userId)
      .is('deleted_at', null),
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
      .is('deleted_at', null)
      .gte('order_date', earliest)
      .lte('order_date', latest),
    supabase
      .from('returns')
      .select(
        'refunded_at, refund_amount_cents, status, orders ( currency, order_date, deleted_at )',
      )
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
            id, status, return_deadline, deleted_at, currency, order_date,
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

  const ordersNative = (orderRows ?? []) as OrderRow[];
  const returnsNative = (returnRows ?? []) as ReturnRow[];
  const inventoryNative = ((inventoryRows ?? []) as InventoryRow[]).filter((item) => {
    const orderItem = one(item.order_items);
    const order = one(orderItem?.orders);
    return !order?.deleted_at;
  });
  const categories = new Map(
    ((categoryRows ?? []) as CategoryRow[]).map((row) => [row.id, row]),
  );

  const orderAmountSpecs: Array<{ cents: number; currency: string; date: string }> = [];
  const orderAmountIndex: Array<{
    orderId: string;
    field: 'subtotal' | 'tax' | 'shipping' | 'discount' | 'total' | 'unit';
    itemId?: string;
  }> = [];

  for (const order of ordersNative) {
    for (const [field, cents] of [
      ['subtotal', order.subtotal_cents],
      ['tax', order.tax_cents],
      ['shipping', order.shipping_cents],
      ['discount', order.discount_cents],
      ['total', order.total_cents],
    ] as const) {
      orderAmountSpecs.push({
        cents,
        currency: order.currency,
        date: order.order_date,
      });
      orderAmountIndex.push({ orderId: order.id, field });
    }
    const items = Array.isArray(order.order_items)
      ? order.order_items
      : order.order_items
        ? [order.order_items]
        : [];
    for (const item of items) {
      orderAmountSpecs.push({
        cents: item.unit_price_cents,
        currency: order.currency,
        date: order.order_date,
      });
      orderAmountIndex.push({ orderId: order.id, field: 'unit', itemId: item.id });
    }
  }

  const convertedOrderAmounts =
    orderAmountSpecs.length > 0
      ? await convertToDisplayCents(supabase, orderAmountSpecs, displayCurrency)
      : [];

  const byOrder = new Map<
    string,
    {
      subtotal: number;
      tax: number;
      shipping: number;
      discount: number;
      total: number;
      units: Map<string, number>;
    }
  >();
  for (let i = 0; i < orderAmountIndex.length; i++) {
    const meta = orderAmountIndex[i]!;
    const cents = convertedOrderAmounts[i] ?? 0;
    const bucket = byOrder.get(meta.orderId) ?? {
      subtotal: 0,
      tax: 0,
      shipping: 0,
      discount: 0,
      total: 0,
      units: new Map<string, number>(),
    };
    if (meta.field === 'unit' && meta.itemId) {
      bucket.units.set(meta.itemId, cents);
    } else if (meta.field !== 'unit') {
      bucket[meta.field] = cents;
    }
    byOrder.set(meta.orderId, bucket);
  }

  const orders: OrderRow[] = ordersNative.map((order) => {
    const converted = byOrder.get(order.id);
    const items = Array.isArray(order.order_items)
      ? order.order_items
      : order.order_items
        ? [order.order_items]
        : [];
    return {
      ...order,
      currency: displayCurrency,
      subtotal_cents: converted?.subtotal ?? order.subtotal_cents,
      tax_cents: converted?.tax ?? order.tax_cents,
      shipping_cents: converted?.shipping ?? order.shipping_cents,
      discount_cents: converted?.discount ?? order.discount_cents,
      total_cents: converted?.total ?? order.total_cents,
      order_items: items.map((item) => ({
        ...item,
        unit_price_cents: converted?.units.get(item.id) ?? item.unit_price_cents,
      })),
    };
  });

  const returnSpecs = returnsNative.map((row) => {
    const order = one(row.orders);
    return {
      cents: row.refund_amount_cents,
      currency: order?.currency ?? displayCurrency,
      date: (row.refunded_at ?? order?.order_date ?? today).slice(0, 10),
    };
  });
  const convertedRefunds =
    returnSpecs.length > 0
      ? await convertToDisplayCents(supabase, returnSpecs, displayCurrency)
      : [];
  const returns: ReturnRow[] = returnsNative.map((row, i) => ({
    ...row,
    refund_amount_cents: convertedRefunds[i] ?? row.refund_amount_cents,
  }));

  const inventorySpecs = inventoryNative.map((item) => {
    const order = one(one(item.order_items)?.orders);
    return {
      cents: item.cost_cents,
      currency: order?.currency ?? displayCurrency,
      date: order?.order_date ?? today,
    };
  });
  const convertedInventory =
    inventorySpecs.length > 0
      ? await convertToDisplayCents(supabase, inventorySpecs, displayCurrency)
      : [];
  const inventory = inventoryNative.map((item, i) => ({
    ...item,
    cost_cents: convertedInventory[i] ?? item.cost_cents,
  }));

  const spendOrders = toSpendOrders(orders);
  const spendRefunds = toSpendRefunds(returns);
  const current = spend(spendOrders, spendRefunds, period);
  const previousBreakdown = spend(spendOrders, spendRefunds, previous);

  return {
    timezone,
    today,
    range,
    period,
    previousPeriod: previous,
    orderCount: orderCount ?? 0,
    currency: displayCurrency,
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
