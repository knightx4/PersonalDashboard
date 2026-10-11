import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { deadlineLabel } from '@/lib/returns/deadline';
import { ReturnFuse } from '@/components/ui/return-fuse';
import { displayVariant } from '@/lib/inventory/display';
import type { ReturnsTrackerRow } from '@/lib/returns/types';
import { returnMove } from '@/lib/returns/move';
import { MoveLabel } from '@/components/ui/move-label';
import { rowRef, withRun } from '@/lib/core/move';
import { cn } from '@/lib/cn';
import { MarkReturnedButton, ReturnRowMenu, UndoReturnedButton } from './plan-return-button';

export function ReturnItemRow({
  row,
  nested = false,
  working,
}: {
  row: ReturnsTrackerRow;
  /** Under an order's fold, where the row has no order of its own to open. */
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
  // The one button the row keeps carries the accent only when the item needs
  // sending back: marked to return, or past its window (plan #1785).
  const strong = row.returnPlanned || (row.daysLeft != null && row.daysLeft < 0);

  return (
    // Pressing the row opens its order: the name is a link stretched over the
    // row, and the buttons sit above it. Under an order's fold the row is
    // already inside its order, so there is nothing to open.
    <li className={cn('relative row-pad px-4', !nested && 'hover:bg-sunken')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {nested ? (
              row.name
            ) : (
              <Link
                href={`/shopping/orders/${row.orderId}`}
                className="-my-3.5 block py-3.5 after:absolute after:inset-0 after:content-['']"
              >
                {row.name}
              </Link>
            )}
          </p>
          {/* The marker leads the merchant line rather than following the
              name, so the name has the whole width up to the price. */}
          <p className="flex min-w-0 items-baseline gap-2 text-ui text-ink-muted">
            {row.returnPlanned && !returned && (
              <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-accent">
                To return
              </span>
            )}
            {returned && (
              <span className="shrink-0 text-micro font-semibold uppercase tracking-wide">
                Returned
              </span>
            )}
            <span className="min-w-0 truncate">
              {[nested ? null : row.merchantName, displayVariant(row.variant)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </p>
        </div>
        {/* Set against the row's right edge in tabular figures, so the
            prices line up down the list whatever the names beside them. */}
        <p className="tabular shrink-0 text-right text-body font-medium text-ink">
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
      <div className="mt-1 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
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
        <div className="relative z-over-link flex shrink-0 items-center gap-1">
          {returned ? (
            row.returnId && (
              <UndoReturnedButton itemId={row.inventoryItemId} returnId={row.returnId} />
            )
          ) : (
            <>
              <MarkReturnedButton itemId={row.inventoryItemId} strong={strong} />
              <ReturnRowMenu
                itemId={row.inventoryItemId}
                name={row.name}
                planned={row.returnPlanned}
              />
            </>
          )}
        </div>
      </div>
    </li>
  );
}
