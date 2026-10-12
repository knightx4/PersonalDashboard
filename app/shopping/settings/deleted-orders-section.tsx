'use client';

import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import {
  permanentlyDeleteOrder,
  restoreDeletedOrder,
} from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { formatMoney } from '@/lib/money';

export type DeletedOrderRow = {
  id: string;
  order_date: string;
  total_cents: number;
  currency: string;
  external_order_number: string | null;
  deleted_at: string;
  merchants: { name: string } | { name: string }[] | null;
};

/** Dates on this card read as the inboxes' do: "14 Aug 2026". */
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY_UTC = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function DeletedOrdersSection({ orders }: { orders: DeletedOrderRow[] }) {
  return (
    <div className="space-y-3">
      {/* The sentence is the empty state: rows say what the card is once
          there are any (plan #1788, law 15). */}
      {orders.length === 0 ? (
        <p className="text-body text-ink-muted">
          No deleted orders. Orders you remove from the main list wait here: Restore brings an
          order and its inventory back, and Delete forever removes them for good.
        </p>
      ) : (
        // Divides and space, no frame: the settings card around this
        // already said these belong together. Law 11.
        <ul className="divide-y divide-border">
          {orders.map((order) => {
            const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
            const deletedOn = DAY.format(new Date(order.deleted_at));
            // A calendar date with no time: read in UTC so it stays the day it names.
            const orderedOn = DAY_UTC.format(new Date(`${order.order_date}T00:00:00Z`));
            return (
              <li
                key={order.id}
                className="row-pad flex flex-col gap-2 text-body sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    <Link href={`/shopping/orders/${order.id}`} className="hover:underline">
                      {merchant?.name ?? 'Order'}
                    </Link>
                    <span className="font-normal text-ink-muted">
                      {' '}
                      · {orderedOn}
                      {order.external_order_number ? ` · #${order.external_order_number}` : ''}
                    </span>
                  </p>
                  <p className="text-small text-ink-muted">
                    Deleted {deletedOn} · {formatMoney(order.total_cents, order.currency)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <form action={restoreDeletedOrder}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Restore
                    </Button>
                  </form>
                  {/* The one action here with no way back, so it confirms in
                      place: a second click on the same spot, never a dialog. */}
                  <ConfirmStep
                    variant="ghost"
                    size="sm"
                    prompt="This removes the order for good. There is no undo."
                    confirmLabel="Delete forever"
                    pendingLabel="Deleting…"
                    action={permanentlyDeleteOrder}
                    fields={{ orderId: order.id }}
                  >
                    Delete forever
                  </ConfirmStep>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DeletedOrdersTitle() {
  return (
    <span className="flex items-center gap-2">
      <Trash2 className="size-4 text-ink-muted" strokeWidth={1.75} />
      Deleted orders
    </span>
  );
}
