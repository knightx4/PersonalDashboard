'use client';

import { useRouter } from 'next/navigation';
import {
  excludeMerchantFromOrder,
  restoreDeletedOrder,
  softDeleteOrder,
} from '@/app/shopping/orders/actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { useToast } from '@/components/ui/toast';

function isRedirect(err: unknown): boolean {
  const digest =
    typeof err === 'object' && err && 'digest' in err
      ? String((err as { digest: unknown }).digest)
      : '';
  return digest.startsWith('NEXT_REDIRECT');
}

/**
 * The row's two actions. Both arm in place through the menu's own `confirm`
 * -- a first click shows the consequence, a second does it -- so the menu no
 * longer needs its own phase machine, and nothing here reaches for a browser
 * dialog. A delete is soft, so once done it offers the way back in a toast.
 */
export function OrderRowMenu({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const label = merchantName.trim() || 'this sender';

  function orderForm(): FormData {
    const formData = new FormData();
    formData.set('orderId', orderId);
    return formData;
  }

  const items: ActionMenuItem[] = [
    {
      id: 'exclude',
      label: `Don’t import from ${label}`,
      confirm: `Stop importing from ${label}? Removes their orders and skips them on future imports.`,
      onSelect: () => {
        void (async () => {
          try {
            await excludeMerchantFromOrder(orderForm());
          } catch (err) {
            if (isRedirect(err)) throw err;
            toast({
              text: err instanceof Error ? err.message : 'could not mute that merchant',
            });
          }
        })();
      },
    },
    {
      id: 'delete',
      label: 'Delete order',
      destructive: true,
      confirm: 'Delete this order? You can restore it later from Settings.',
      onSelect: () => {
        void (async () => {
          const formData = orderForm();
          try {
            const result = await softDeleteOrder(formData);
            if (!result.ok) {
              toast({ text: result.error });
              return;
            }
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
            router.refresh();
          } catch (err) {
            toast({ text: err instanceof Error ? err.message : 'delete failed' });
          }
        })();
      },
    },
  ];

  return <ActionMenu label="Order actions" items={items} />;
}
