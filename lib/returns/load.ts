import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { todayInTimezone } from '@/lib/money';
import {
  daysBetween,
  DUE_SOON_DAYS,
  isDueSoon,
  isOverdue,
} from '@/lib/returns/deadline';

export type ReturnsView = 'soon' | 'overdue' | 'marked' | 'all';

export const RETURNS_VIEWS: { id: ReturnsView; label: string }[] = [
  { id: 'soon', label: 'Due soon' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'marked', label: 'To return' },
  { id: 'all', label: 'All items' },
];

export function parseReturnsView(raw: string | undefined): ReturnsView {
  return RETURNS_VIEWS.find((entry) => entry.id === raw)?.id ?? 'soon';
}

export type ReturnsTrackerRow = {
  inventoryItemId: string;
  name: string;
  variant: string | null;
  costCents: number;
  orderId: string;
  orderStatus: string;
  merchantId: string | null;
  merchantName: string;
  returnDeadline: string | null;
  daysLeft: number | null;
  returnPlanned: boolean;
  returnWindowDays: number | null;
  delivered: boolean;
};

export type ReturnsTrackerData = {
  timezone: string;
  today: string;
  view: ReturnsView;
  dueSoonDays: number;
  rows: ReturnsTrackerRow[];
  counts: Record<ReturnsView, number>;
};

type InventoryQueryRow = {
  id: string;
  name: string;
  variant: string | null;
  cost_cents: number;
  return_planned: boolean;
  status: string;
  order_items:
    | {
        order_id: string;
        orders:
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchant_id: string | null;
              merchants: { id: string; name: string; default_return_window_days: number | null } | null;
            }
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchant_id: string | null;
              merchants: { id: string; name: string; default_return_window_days: number | null } | null;
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
              merchant_id: string | null;
              merchants: { id: string; name: string; default_return_window_days: number | null } | null;
            }
          | {
              id: string;
              status: string;
              return_deadline: string | null;
              merchant_id: string | null;
              merchants: { id: string; name: string; default_return_window_days: number | null } | null;
            }[]
          | null;
      }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function buildRow(item: InventoryQueryRow, today: string): ReturnsTrackerRow | null {
  if (item.status !== 'owned') return null;
  const orderItem = one(item.order_items);
  const order = one(orderItem?.orders);
  if (!order) return null;
  if (order.status === 'cancelled' || order.status === 'returned') return null;

  const merchant = one(order.merchants);
  const deadline = order.return_deadline;
  const daysLeft = deadline ? daysBetween(today, deadline) : null;

  return {
    inventoryItemId: item.id,
    name: item.name,
    variant: item.variant,
    costCents: item.cost_cents,
    orderId: order.id,
    orderStatus: order.status,
    merchantId: order.merchant_id,
    merchantName: merchant?.name ?? 'Unknown merchant',
    returnDeadline: deadline,
    daysLeft,
    returnPlanned: item.return_planned,
    returnWindowDays: merchant?.default_return_window_days ?? null,
    delivered: deadline != null || order.status === 'delivered',
  };
}

function matchesView(row: ReturnsTrackerRow, view: ReturnsView): boolean {
  switch (view) {
    case 'soon':
      return row.daysLeft != null && isDueSoon(row.daysLeft);
    case 'overdue':
      return row.daysLeft != null && isOverdue(row.daysLeft);
    case 'marked':
      return row.returnPlanned;
    case 'all':
      return true;
  }
}

function sortRows(a: ReturnsTrackerRow, b: ReturnsTrackerRow): number {
  // Planned first within a view feels noisy on "all"; prefer urgency.
  const aDays = a.daysLeft ?? Number.POSITIVE_INFINITY;
  const bDays = b.daysLeft ?? Number.POSITIVE_INFINITY;
  if (aDays !== bDays) return aDays - bDays;
  if (a.returnPlanned !== b.returnPlanned) return a.returnPlanned ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export async function loadReturnsTracker(
  supabase: SupabaseClient,
  userId: string,
  view: ReturnsView,
): Promise<ReturnsTrackerData> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();

  const timezone = profile?.timezone ?? 'UTC';
  const today = todayInTimezone(timezone);

  const { data: inventoryRows, error } = await supabase
    .from('inventory_items')
    .select(
      `
      id, name, variant, cost_cents, return_planned, status,
      order_items!inner (
        order_id,
        orders!inner (
          id, status, return_deadline, merchant_id,
          merchants ( id, name, default_return_window_days )
        )
      )
    `,
    )
    .eq('user_id', userId)
    .eq('status', 'owned');

  if (error) throw error;

  const { data: overrides } = await supabase
    .from('merchant_return_policies')
    .select('merchant_id, return_window_days')
    .eq('user_id', userId);

  const overrideByMerchant = new Map(
    (overrides ?? []).map((row) => [
      row.merchant_id as string,
      row.return_window_days as number | null,
    ]),
  );

  const allRows: ReturnsTrackerRow[] = [];
  for (const raw of inventoryRows ?? []) {
    const row = buildRow(raw as unknown as InventoryQueryRow, today);
    if (!row) continue;
    if (row.merchantId && overrideByMerchant.has(row.merchantId)) {
      row.returnWindowDays = overrideByMerchant.get(row.merchantId) ?? null;
    }
    allRows.push(row);
  }

  const counts: Record<ReturnsView, number> = {
    soon: 0,
    overdue: 0,
    marked: 0,
    all: allRows.length,
  };
  for (const row of allRows) {
    if (row.daysLeft != null && isDueSoon(row.daysLeft)) counts.soon += 1;
    if (row.daysLeft != null && isOverdue(row.daysLeft)) counts.overdue += 1;
    if (row.returnPlanned) counts.marked += 1;
  }

  return {
    timezone,
    today,
    view,
    dueSoonDays: DUE_SOON_DAYS,
    rows: allRows.sort(sortRows),
    counts,
  };
}

export function filterReturnsRows(
  rows: ReturnsTrackerRow[],
  view: ReturnsView,
  merchantId?: string,
): ReturnsTrackerRow[] {
  return rows
    .filter((row) => matchesView(row, view))
    .filter((row) => !merchantId || row.merchantId === merchantId);
}
