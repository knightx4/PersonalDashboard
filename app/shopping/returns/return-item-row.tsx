import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { deadlineLabel } from '@/lib/returns/deadline';
import { ReturnFuse } from '@/components/ui/return-fuse';
import { displayVariant } from '@/lib/inventory/display';
import type { ReturnsTrackerRow } from '@/lib/returns/types';
import { returnMove } from '@/lib/returns/move';
import { MoveLabel } from '@/components/ui/move-label';
import { rowRef, withRun } from '@/lib/core/move';
import { MarkReturnedButton, PlanReturnButton, UndoReturnedButton } from './plan-return-button';

export function ReturnItemRow({
  row,
  nested = false,
  working,
}: {
  row: ReturnsTrackerRow;
  /** When nested under an order accordion, hide the redundant “View order” link. */
  nested?: boolean;
  /**
   * Refs an open Ask Dash hand-off is about (plan #1568). The row reads "Dash
   * is on it" when one names its item, its return or its order.
   */
  working?: readonly string[];
}) {
  const urgency =
    row.daysLeft != null && row.daysLeft <= 7 ? 'text-caution font-medium' : 'text-ink-muted';
  const returned = row.status === 'returned';
  // Whose move it is (plan #1454): on you inside the window, waiting on the
  // carrier before it arrives, nothing once it is back.
  const move = withRun(returnMove(row), working, [
    rowRef('public.inventory_items', row.inventoryItemId),
    rowRef('public.returns', row.returnId),
    rowRef('public.orders', row.orderId),
  ]);

  return (
    <li className="row-pad flex flex-col gap-3 px-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink">
              {row.name}
              {row.returnPlanned && !returned && (
                <span className="ml-2 text-micro font-semibold uppercase tracking-wide text-accent">
                  To return
                </span>
              )}
              {returned && (
                <span className="ml-2 text-micro font-semibold uppercase tracking-wide text-ink-muted">
                  Returned
                </span>
              )}
            </p>
            <p className="truncate text-ui text-ink-muted">
              {[nested ? null : row.merchantName, displayVariant(row.variant)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <p className="tabular shrink-0 text-body font-medium text-ink">
            {formatMoney(row.costCents)}
          </p>
        </div>
        {/* Time left as a length, above the same fact in words. */}
        {!returned && (
          <ReturnFuse
            daysLeft={row.daysLeft}
            windowDays={row.returnWindowDays}
            deadline={row.returnDeadline}
            className="mt-2 max-w-48"
          />
        )}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {move && <MoveLabel move={move.move} title={move.title} />}
          <p className={`text-small ${returned ? 'text-ink-muted' : urgency}`}>
            {returned
              ? row.refundedAt
                ? `Returned ${row.refundedAt}`
                : 'Returned'
              : row.returnDeadline && row.daysLeft != null
                ? deadlineLabel(row.daysLeft, row.returnDeadline)
                : row.returnWindowDays == null
                  ? 'No return window set for this merchant'
                  : 'Awaiting delivery for deadline'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
        {returned && row.returnId ? (
          <UndoReturnedButton itemId={row.inventoryItemId} returnId={row.returnId} />
        ) : (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <PlanReturnButton itemId={row.inventoryItemId} planned={row.returnPlanned} />
            <MarkReturnedButton itemId={row.inventoryItemId} />
          </div>
        )}
        {!nested && (
          <Link
            href={`/shopping/orders/${row.orderId}`}
            className="text-small text-ink-muted transition-colors duration-150 hover:text-accent hover:underline"
          >
            View order
          </Link>
        )}
      </div>
    </li>
  );
}
