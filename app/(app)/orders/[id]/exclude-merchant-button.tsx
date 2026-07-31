'use client';

import { useState } from 'react';
import { excludeMerchantFromOrder } from '@/app/(app)/orders/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

export function ExcludeMerchantButton({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = merchantName.trim() || 'this sender';

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
        Don’t import from {label}
      </Button>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <p className="max-w-[18rem] text-right text-[12px] text-ink-muted">
        Stop importing from {label}? Removes their orders and skips them on future imports.
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
                await excludeMerchantFromOrder(formData);
              } catch (err) {
                const digest =
                  typeof err === 'object' && err && 'digest' in err
                    ? String((err as { digest: unknown }).digest)
                    : '';
                if (digest.startsWith('NEXT_REDIRECT')) throw err;
                setError(err instanceof Error ? err.message : 'Could not mute that merchant.');
                setPending(false);
              }
            })();
          }}
        >
          {pending ? 'Working…' : 'Confirm'}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}
