'use client';

import { useCallback, useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Group } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/money';
import { matchOrders, type SearchableOrder } from '@/lib/review/attach-email';
import type { ReviewEmailRow } from '@/lib/review/load';
import { attachEmailToOrder } from './actions';

/** One line naming an order: merchant, date and number. */
function orderLabel(order: {
  merchantName: string;
  orderDate: string;
  externalOrderNumber: string | null;
}): string {
  return [
    order.merchantName,
    order.orderDate,
    order.externalOrderNumber ? `#${order.externalOrderNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Attach the email to an order: runs the action and says what happened. The
 * row leaves the queue on success, because the action revalidates the page.
 */
export function useAttachEmail(): {
  attach: (messageId: string, orderId: string) => void;
  pending: boolean;
} {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const attach = useCallback(
    (messageId: string, orderId: string) =>
      startTransition(async () => {
        const result = await attachEmailToOrder(messageId, orderId);
        toast({ text: result.error ?? result.message ?? 'Attached.' });
      }),
    [toast],
  );
  return { attach, pending };
}

/**
 * The orders a waiting email probably belongs to (a shipping, delivery or
 * return email, or a confirmation that is often a shipping notice), each a
 * press away, numbered for the keys 1 to 3 the queue listens for, and a search
 * over every order for when none of them is right. Follows MessageRow and
 * OtherRolePicker on the jobs review queue.
 */
export function AttachChoices({
  row,
  searchOrders,
}: {
  row: ReviewEmailRow;
  searchOrders: SearchableOrder[];
}) {
  const { attach, pending } = useAttachEmail();

  return (
    <div className="space-y-2 pt-1">
      {row.candidates.length === 0 ? (
        <p className="text-ui text-ink-muted">No order looks like a match.</p>
      ) : (
        <ul className="space-y-1.5">
          {row.candidates.map((candidate, index) => (
            <li key={candidate.orderId} className="flex flex-wrap items-center gap-2">
              <kbd className="rounded border border-border bg-canvas px-1.5 text-small text-ink-muted">
                {index + 1}
              </kbd>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui text-ink">{orderLabel(candidate)}</p>
                <p className="truncate text-small text-ink-muted">
                  {candidate.reason} · {formatMoney(candidate.totalCents, candidate.currency)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                pending={pending}
                onClick={() => attach(row.messageId, candidate.orderId)}
              >
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}

      <OtherOrderPicker row={row} orders={searchOrders} onPick={attach} pending={pending} />
    </div>
  );
}

/**
 * Search every order by merchant, order number or date, and attach to one of
 * what is left, for when the suggestions missed.
 */
function OtherOrderPicker({
  row,
  orders,
  onPick,
  pending,
}: {
  row: ReviewEmailRow;
  orders: SearchableOrder[];
  onPick: (messageId: string, orderId: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  if (orders.length === 0) return null;

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
        {row.candidates.length === 0 ? 'Find the order' : 'Some other order'}
      </Button>
    );
  }

  const matches = matchOrders(orders, query);

  return (
    <Group title="Attach to another order">
      <Input
        id={`other-order-${row.messageId}`}
        autoFocus
        value={query}
        disabled={pending}
        placeholder="Merchant, order number or date"
        aria-label="Search every order by merchant, order number or date"
        onChange={(event) => setQuery(event.target.value)}
      />

      {matches.length === 0 ? (
        <p className="text-small text-ink-muted">No order matches that.</p>
      ) : (
        <ul className="space-y-1">
          {matches.map((order) => (
            <li key={order.orderId}>
              <button
                type="button"
                disabled={pending}
                onClick={() => onPick(row.messageId, order.orderId)}
                className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate text-ui text-ink">
                  {orderLabel(order)}
                </span>
                <span className="tabular text-small text-ink-muted">
                  {formatMoney(order.totalCents, order.currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </Group>
  );
}
