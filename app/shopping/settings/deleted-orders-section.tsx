'use client';

import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import {
  permanentlyDeleteOrder,
  restoreDeletedOrder,
} from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
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

export function DeletedOrdersSection({ orders }: { orders: DeletedOrderRow[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Orders you removed from the main list. Restore brings the order and its inventory back;
        delete forever removes them for good.
      </p>
      {orders.length === 0 ? (
        <p className="text-sm text-ink-faint">No deleted orders.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {orders.map((order) => {
            const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
            const deletedOn = new Date(order.deleted_at).toLocaleDateString();
            return (
              <li
                key={order.id}
                className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    <Link href={`/shopping/orders/${order.id}`} className="hover:underline">
                      {merchant?.name ?? 'Order'}
                    </Link>
                    <span className="font-normal text-ink-muted">
                      {' '}
                      · {order.order_date}
                      {order.external_order_number ? ` · #${order.external_order_number}` : ''}
                    </span>
                  </p>
                  <p className="text-[12px] text-ink-faint">
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
                  <form
                    action={permanentlyDeleteOrder}
                    onSubmit={(event) => {
                      const ok = window.confirm(
                        'Delete this order forever? This cannot be undone.',
                      );
                      if (!ok) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="orderId" value={order.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Delete forever
                    </Button>
                  </form>
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
