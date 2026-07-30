'use client';

import {
  excludeMerchantFromOrder,
  softDeleteOrder,
} from '@/app/(app)/orders/actions';
import { ActionMenu } from '@/components/ui/action-menu';

export function OrderRowMenu({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const label = merchantName.trim() || 'this sender';

  return (
    <ActionMenu
      label="Order actions"
      items={[
        {
          id: 'exclude',
          label: `Don’t import from ${label}`,
          formAction: excludeMerchantFromOrder,
          formFields: { orderId },
          confirm: `Stop importing from ${label}?\n\nRemoves all of their orders from Shopping Manager and skips them on future imports (including Reset & re-scan). You can undo this in Settings.`,
        },
        {
          id: 'delete',
          label: 'Delete order',
          destructive: true,
          formAction: softDeleteOrder,
          formFields: { orderId },
          confirm: `Delete ${label} and its inventory items?\n\nYou can restore it later from Settings → Deleted orders.`,
        },
      ]}
    />
  );
}
