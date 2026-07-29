'use client';

import { softDeleteOrder } from '@/app/(app)/orders/actions';
import { Button } from '@/components/ui/button';

export function DeleteOrderButton({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const label = merchantName.trim() || 'this order';

  return (
    <form
      action={softDeleteOrder}
      onSubmit={(event) => {
        const ok = window.confirm(
          `Delete ${label} and its inventory items?\n\nYou can restore it later from Settings → Deleted orders.`,
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="ghost" size="sm">
        Delete order
      </Button>
    </form>
  );
}
