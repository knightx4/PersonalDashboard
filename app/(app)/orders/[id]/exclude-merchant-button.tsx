'use client';

import { excludeMerchantFromOrder } from '@/app/(app)/orders/actions';
import { Button } from '@/components/ui/button';

export function ExcludeMerchantButton({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const label = merchantName.trim() || 'this sender';

  return (
    <form
      action={excludeMerchantFromOrder}
      onSubmit={(event) => {
        const ok = window.confirm(
          `Stop importing from ${label}?\n\nRemoves all of their orders from Shopping Manager and skips them on future imports (including Reset & re-scan). You can undo this in Settings.`,
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="ghost" size="sm">
        Don’t import from {label}
      </Button>
    </form>
  );
}
