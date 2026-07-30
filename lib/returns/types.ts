import { isDueSoon, isOverdue } from '@/lib/returns/deadline';

export type ReturnsView = 'soon' | 'overdue' | 'marked' | 'all' | 'returned';

export const RETURNS_VIEWS: { id: ReturnsView; label: string }[] = [
  { id: 'soon', label: 'Due soon' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'marked', label: 'To return' },
  { id: 'all', label: 'All items' },
  { id: 'returned', label: 'Returned' },
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
  orderDate: string | null;
  externalOrderNumber: string | null;
  orderStatus: string;
  merchantId: string | null;
  merchantName: string;
  returnDeadline: string | null;
  daysLeft: number | null;
  returnPlanned: boolean;
  returnWindowDays: number | null;
  delivered: boolean;
  status: 'owned' | 'returned';
  /** When status is returned, the linked refunded return row (for undo). */
  returnId: string | null;
  refundedAt: string | null;
};

export type ReturnsTrackerData = {
  timezone: string;
  today: string;
  view: ReturnsView;
  dueSoonDays: number;
  rows: ReturnsTrackerRow[];
  counts: Record<ReturnsView, number>;
};

function matchesView(row: ReturnsTrackerRow, view: ReturnsView): boolean {
  if (view === 'returned') return row.status === 'returned';
  if (row.status !== 'owned') return false;
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

export function filterReturnsRows(
  rows: ReturnsTrackerRow[],
  view: ReturnsView,
  merchantId?: string,
): ReturnsTrackerRow[] {
  return rows
    .filter((row) => matchesView(row, view))
    .filter((row) => !merchantId || row.merchantId === merchantId);
}
