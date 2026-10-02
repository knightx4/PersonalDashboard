import Link from 'next/link';
import { Disclosure } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
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
      className: urgent ? 'text-caution font-medium' : 'text-ink-muted',
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
            className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}
          >
            <Disclosure
              remember={`shopping.fold.return.${group.orderId}`}
              summaryClassName="row-pad items-start gap-3 rounded-none px-4 py-0 hover:bg-sunken"
              bodyClassName=""
              title={
                <span className="block min-w-0">
                  <span className="block truncate">{orderTitle(group)}</span>
                  <span className="mt-0.5 block truncate text-ui font-normal text-ink-muted">
                    {orderMeta(group)}
                  </span>
                  {deadline && (
                    <span className={`mt-1 block text-small font-normal ${deadline.className}`}>
                      {deadline.text}
                    </span>
                  )}
                </span>
              }
            >
              <div className="row-pad flex items-center justify-end border-t border-border px-4">
                <Link
                  href={`/shopping/orders/${group.orderId}`}
                  className="text-small text-ink-muted transition-colors duration-150 hover:text-accent hover:underline"
                >
                  View full order
                </Link>
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {group.items.map((row) => (
                  <ReturnItemRow key={row.inventoryItemId} row={row} nested />
                ))}
              </ul>
            </Disclosure>
          </li>
        );
      })}
    </ul>
  );
}
