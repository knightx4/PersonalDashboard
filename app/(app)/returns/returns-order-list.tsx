import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { deadlineLabel } from '@/lib/returns/deadline';
import type { ReturnsOrderGroup } from '@/lib/returns/grouping';
import type { ReturnsTrackerRow } from '@/lib/returns/types';
import { ReturnItemRow } from './return-item-row';

function orderTitle(group: ReturnsOrderGroup<ReturnsTrackerRow>): string {
  const number = group.externalOrderNumber
    ? `#${group.externalOrderNumber}`
    : 'Order';
  return `${group.merchantName} · ${number}`;
}

function orderMeta(group: ReturnsOrderGroup<ReturnsTrackerRow>): string {
  const parts: string[] = [];
  if (group.orderDate) parts.push(group.orderDate);
  const count = group.items.length;
  parts.push(`${count} item${count === 1 ? '' : 's'}`);
  if (group.plannedCount > 0) {
    parts.push(`${group.plannedCount} marked to return`);
  }
  if (group.returnedCount > 0 && group.returnedCount === group.items.length) {
    parts.push('All returned');
  } else if (group.returnedCount > 0) {
    parts.push(`${group.returnedCount} returned`);
  }
  return parts.join(' · ');
}

function orderDeadlineLine(group: ReturnsOrderGroup<ReturnsTrackerRow>): {
  text: string;
  className: string;
} | null {
  if (group.returnedCount === group.items.length) return null;
  if (group.daysLeft != null && group.returnDeadline) {
    const urgent = group.daysLeft <= 7;
    return {
      text: deadlineLabel(group.daysLeft, group.returnDeadline),
      className: urgent ? 'text-accent-orange font-medium' : 'text-ink-muted',
    };
  }
  return null;
}

/**
 * Orders accordion — unfold an order, then mark / return each nested item.
 * Uses native details/summary so expand feels instantaneous with no round-trip.
 */
export function ReturnsOrderList({
  groups,
}: {
  groups: ReturnsOrderGroup<ReturnsTrackerRow>[];
}) {
  return (
    <ul className="space-y-2">
      {groups.map((group) => {
        const deadline = orderDeadlineLine(group);
        return (
          <li
            key={group.orderId}
            className="overflow-hidden rounded-card border border-border bg-surface"
          >
            <details className="group/order open:[&_summary_.chevron]:rotate-90">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="chevron mt-0.5 size-4 shrink-0 text-ink-faint transition-transform duration-150"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{orderTitle(group)}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                    {orderMeta(group)}
                  </p>
                  {deadline && (
                    <p className={`mt-1 text-[12px] ${deadline.className}`}>{deadline.text}</p>
                  )}
                </div>
              </summary>
              <div className="flex items-center justify-end border-t border-border px-4 py-2">
                <Link
                  href={`/orders/${group.orderId}`}
                  className="text-[12px] text-ink-muted hover:text-brand hover:underline"
                >
                  View full order
                </Link>
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {group.items.map((row) => (
                  <ReturnItemRow key={row.inventoryItemId} row={row} nested />
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
