'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { softDeleteOrder } from '@/app/shopping/orders/actions';
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
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = merchantName.trim() || 'this order';

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Delete order
      </Button>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <p className="max-w-[16rem] text-right text-[12px] text-ink-muted">
        Delete {label}? You can restore it later from Settings.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            setPending(true);
            void (async () => {
              const formData = new FormData();
              formData.set('orderId', orderId);
              try {
                const result = await softDeleteOrder(formData);
                if (!result.ok) {
                  setError(result.error);
                  setPending(false);
                  return;
                }
                router.push('/shopping/orders');
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Delete failed.');
                setPending(false);
              }
            })();
          }}
        >
          {pending ? 'Deleting…' : 'Confirm delete'}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}
