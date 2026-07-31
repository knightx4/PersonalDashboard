'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { softDeleteOrder } from '@/app/(app)/orders/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

export function DeleteOrderButton({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = merchantName.trim() || 'this order';

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          const ok = window.confirm(
            `Delete ${label} and its inventory items?\n\nYou can restore it later from Settings → Deleted orders.`,
          );
          if (!ok) return;

          setError(null);
          startTransition(async () => {
            const formData = new FormData();
            formData.set('orderId', orderId);
            const result = await softDeleteOrder(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push('/orders');
            router.refresh();
          });
        }}
      >
        {pending ? 'Deleting…' : 'Delete order'}
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}
