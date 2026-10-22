'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReviewRowBody, type MessageOpen } from '@/components/jobs/review/rows';
import type { ReviewOutcome } from '@/components/jobs/review/handlers';
import { FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { ReviewRow, SearchableRole } from '@/lib/jobs/review/load';

/**
 * One review item in the Jobs Inbox (plan #2502.2): the row the Review page
 * draws, with its own buttons, inside the Inbox's card.
 *
 * A press that works takes the row off at once, says what it did in a toast
 * and refreshes the page, so the next item moves up and the counts follow.
 * One that fails keeps the row and says why under it. A decline goes out
 * through its own toast with Undo, which puts the row back.
 */
export function ReviewInboxRow({
  row,
  timezone,
  companyNames,
  allRoles,
  startOpen,
  failed,
}: {
  row: ReviewRow;
  timezone: string;
  companyNames: string[];
  allRoles: SearchableRole[];
  /** The gallery's way to draw a message with its picker or form open. */
  startOpen?: MessageOpen;
  /** The gallery's way to draw the row after a press failed. */
  failed?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(failed ?? null);

  const onDecline = useMemo(
    () => ({
      declined: () => {
        setGone(true);
        router.refresh();
      },
      restored: () => {
        setGone(false);
        router.refresh();
      },
    }),
    [router],
  );

  const onDone = (outcome: ReviewOutcome) => {
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setError(null);
    setGone(true);
    toast({ text: outcome.message });
    router.refresh();
  };

  if (gone) return null;

  return (
    <li className="card-pad-x row-pad">
      <ReviewRowBody
        row={row}
        timezone={timezone}
        companyNames={companyNames}
        allRoles={allRoles}
        onDone={onDone}
        onDecline={onDecline}
        shortcuts={false}
        startOpen={startOpen}
      />
      <FieldError>{error}</FieldError>
    </li>
  );
}
