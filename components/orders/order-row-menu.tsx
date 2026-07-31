'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  excludeMerchantFromOrder,
  softDeleteOrder,
} from '@/app/(app)/orders/actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';

export function OrderRowMenu({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<'menu' | 'delete' | 'exclude'>('menu');
  const [pending, setPending] = useState(false);
  const label = merchantName.trim() || 'this sender';

  const items: ActionMenuItem[] =
    phase === 'delete'
      ? [
          {
            id: 'delete-confirm',
            label: pending ? 'Deleting…' : 'Confirm delete',
            destructive: true,
            disabled: pending,
            closeOnSelect: false,
            onSelect: () => {
              setPending(true);
              void (async () => {
                const formData = new FormData();
                formData.set('orderId', orderId);
                try {
                  const result = await softDeleteOrder(formData);
                  if (!result.ok) {
                    window.alert(result.error);
                    setPending(false);
                    setPhase('menu');
                    return;
                  }
                  router.push('/orders');
                  router.refresh();
                } catch (err) {
                  window.alert(err instanceof Error ? err.message : 'Delete failed.');
                  setPending(false);
                  setPhase('menu');
                }
              })();
            },
          },
          {
            id: 'delete-cancel',
            label: 'Cancel',
            disabled: pending,
            closeOnSelect: false,
            onSelect: () => setPhase('menu'),
          },
        ]
      : phase === 'exclude'
        ? [
            {
              id: 'exclude-confirm',
              label: pending ? 'Working…' : `Confirm mute ${label}`,
              destructive: true,
              disabled: pending,
              closeOnSelect: false,
              onSelect: () => {
                setPending(true);
                void (async () => {
                  const formData = new FormData();
                  formData.set('orderId', orderId);
                  try {
                    await excludeMerchantFromOrder(formData);
                  } catch (err) {
                    const digest =
                      typeof err === 'object' && err && 'digest' in err
                        ? String((err as { digest: unknown }).digest)
                        : '';
                    if (digest.startsWith('NEXT_REDIRECT')) throw err;
                    window.alert(
                      err instanceof Error ? err.message : 'Could not mute that merchant.',
                    );
                    setPending(false);
                    setPhase('menu');
                  }
                })();
              },
            },
            {
              id: 'exclude-cancel',
              label: 'Cancel',
              disabled: pending,
              closeOnSelect: false,
              onSelect: () => setPhase('menu'),
            },
          ]
        : [
            {
              id: 'exclude',
              label: `Don’t import from ${label}`,
              closeOnSelect: false,
              onSelect: () => setPhase('exclude'),
            },
            {
              id: 'delete',
              label: 'Delete order',
              destructive: true,
              closeOnSelect: false,
              onSelect: () => setPhase('delete'),
            },
          ];

  return (
    <ActionMenu
      label="Order actions"
      items={items}
      onOpenChange={(open) => {
        if (!open && !pending) setPhase('menu');
      }}
    />
  );
}
