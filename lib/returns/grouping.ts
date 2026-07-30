export type ReturnsGroupMode = 'items' | 'orders';

export const RETURNS_GROUPS: { id: ReturnsGroupMode; label: string }[] = [
  { id: 'items', label: 'Items' },
  { id: 'orders', label: 'Orders' },
];

export function parseReturnsGroup(raw: string | undefined): ReturnsGroupMode {
  return raw === 'orders' ? 'orders' : 'items';
}

/** Minimal row shape needed to group returns by order. */
export type GroupableReturnRow = {
  inventoryItemId: string;
  orderId: string;
  orderDate: string | null;
  externalOrderNumber: string | null;
  merchantId: string | null;
  merchantName: string;
  daysLeft: number | null;
  returnDeadline: string | null;
  returnPlanned: boolean;
  status: 'owned' | 'returned';
};

export type ReturnsOrderGroup<T extends GroupableReturnRow = GroupableReturnRow> = {
  orderId: string;
  orderDate: string | null;
  externalOrderNumber: string | null;
  merchantId: string | null;
  merchantName: string;
  items: T[];
  /** Soonest deadline among items that still have one. */
  daysLeft: number | null;
  returnDeadline: string | null;
  plannedCount: number;
  returnedCount: number;
};

function groupSortKey(group: ReturnsOrderGroup): number {
  if (group.daysLeft != null) return group.daysLeft;
  // Returned-only groups sort after active ones by order date (handled separately).
  return Number.POSITIVE_INFINITY;
}

/**
 * Collapse flat return rows into order groups, preserving item urgency sort
 * inside each order and ranking groups by soonest deadline.
 */
export function groupReturnsByOrder<T extends GroupableReturnRow>(
  rows: T[],
): ReturnsOrderGroup<T>[] {
  const byOrder = new Map<string, ReturnsOrderGroup<T>>();

  for (const row of rows) {
    let group = byOrder.get(row.orderId);
    if (!group) {
      group = {
        orderId: row.orderId,
        orderDate: row.orderDate,
        externalOrderNumber: row.externalOrderNumber,
        merchantId: row.merchantId,
        merchantName: row.merchantName,
        items: [],
        daysLeft: null,
        returnDeadline: null,
        plannedCount: 0,
        returnedCount: 0,
      };
      byOrder.set(row.orderId, group);
    }
    group.items.push(row);
    if (row.returnPlanned && row.status === 'owned') group.plannedCount += 1;
    if (row.status === 'returned') group.returnedCount += 1;

    if (row.daysLeft != null) {
      if (group.daysLeft == null || row.daysLeft < group.daysLeft) {
        group.daysLeft = row.daysLeft;
        group.returnDeadline = row.returnDeadline;
      }
    }
  }

  return [...byOrder.values()].sort((a, b) => {
    const aKey = groupSortKey(a);
    const bKey = groupSortKey(b);
    if (aKey !== bKey) return aKey - bKey;
    const aDate = a.orderDate ?? '';
    const bDate = b.orderDate ?? '';
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return a.merchantName.localeCompare(b.merchantName);
  });
}
