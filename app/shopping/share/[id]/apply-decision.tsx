'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { applyDecision } from '../actions';

/**
 * Accepting one answer.
 *
 * Per group and explicit, never in bulk and never automatic: the shared page
 * is a proposal, and turning a proposal into forty status changes should take
 * a deliberate click each time. The button says what will happen, in the
 * numbers she gave, so it cannot be pressed by accident.
 */
export function ApplyDecision({
  shareId,
  groupKey,
  sellQty,
  giveawayQty,
}: {
  shareId: string;
  groupKey: string;
  sellQty: number;
  giveawayQty: number;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  if (sellQty === 0 && giveawayQty === 0) {
    // Keep is not an action, so there is nothing to apply.
    return <span className="text-[12px] text-ink-faint">Keeping</span>;
  }

  const label = [
    sellQty > 0 && `Sell ${sellQty}`,
    giveawayQty > 0 && `give away ${giveawayQty}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex items-center gap-2">
      {note ? (
        <span className="text-[12px] text-ink-muted">{note}</span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await applyDecision({ shareId, groupKey });
              setNote(result.error ?? result.message ?? null);
            })
          }
        >
          {pending ? 'Applying…' : label}
        </Button>
      )}
    </div>
  );
}
