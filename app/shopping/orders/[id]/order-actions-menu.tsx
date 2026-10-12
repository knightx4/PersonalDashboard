'use client';

import { useRouter } from 'next/navigation';
import {
  excludeMerchantFromOrder,
  restoreDeletedOrder,
  softDeleteOrder,
} from '@/app/shopping/orders/actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { useToast } from '@/components/ui/toast';

/** restoreDeletedOrder ends in redirect(); when that surfaces as a throw the restore still happened. */
function isRedirect(err: unknown): boolean {
  const digest =
    typeof err === 'object' && err && 'digest' in err
      ? String((err as { digest: unknown }).digest)
      : '';
  return digest.startsWith('NEXT_REDIRECT');
}

/**
 * The order's less frequent actions, behind one menu after the two buttons
 * (plan #1782): stop importing from the sender, delete the order, and the
 * review queue. Each of the first two confirms inside the menu before it runs.
 */
export function OrderActionsMenu({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const sender = merchantName?.trim() || 'this sender';
  const order = merchantName?.trim() || 'this order';

  const items: ActionMenuItem[] = [
    {
      id: 'exclude',
      label: `Don’t import from ${sender}`,
      confirm: `Stop importing from ${sender}? Removes their orders and skips them on future imports.`,
      destructive: true,
      formAction: excludeMerchantFromOrder,
      formFields: { orderId },
    },
    {
      id: 'delete',
      label: 'Delete order',
      confirm: `Delete ${order}? You can restore it later from Settings.`,
      destructive: true,
      formFields: { orderId },
      formAction: async (formData) => {
        const result = await softDeleteOrder(formData);
        if (!result.ok) throw new Error(result.error);
        // A soft delete is reversible, so the confirm is the gate and this is
        // the way back once it has gone through.
        toast({
          text: 'order deleted',
          undone: 'order restored',
          undo: async () => {
            try {
              await restoreDeletedOrder(formData);
            } catch (err) {
              if (!isRedirect(err)) throw err;
            }
            router.refresh();
          },
        });
        router.push('/shopping/orders');
        router.refresh();
      },
    },
    { id: 'review', label: 'Review queue', href: '/shopping/review' },
  ];

  return (
    <ActionMenu
      label="More order actions"
      items={items}
      align="start"
      triggerClassName="size-7 border border-border"
    />
  );
}
