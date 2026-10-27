'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { heldOnLabel } from '@/lib/you/board';
import { optionLabel } from '@/lib/you/board-questions';
import type { DueTripwire } from '@/lib/you/board-tripwires';

/**
 * A tripwire that fell due (plan #2581.10), on the Board tab: the decision,
 * what was chosen, and the condition the board set to reopen it. The person
 * says whether it happened. It happened puts the decision back on the next
 * meeting's agenda; it did not clears the wire. Left alone, the Sunday
 * meeting checks it from their rows.
 */

export type TripwireAnswerAction = (questionId: string, tripped: boolean) => Promise<{ error: string | null }>;

/** "You chose B, Keep the search full time · check on 31 Jan 2027". */
export function tripwireMeta(wire: DueTripwire): string {
  const chose = optionLabel(wire.options, wire.chosen);
  return [chose ? `You chose ${chose}` : null, wire.checkOn ? `check on ${heldOnLabel(wire.checkOn)}` : null]
    .filter(Boolean)
    .join(' · ');
}

export function TripwireRow({
  wire,
  answer,
  startError = null,
}: {
  wire: DueTripwire;
  answer: TripwireAnswerAction;
  /** Draw the presses with this failure showing. Only the gallery sets it. */
  startError?: string | null;
}) {
  const [settled, setSettled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(startError);
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<boolean | null>(null);
  const press = (tripped: boolean) => {
    setError(null);
    setPressed(tripped);
    startTransition(async () => {
      const result = await answer(wire.questionId, tripped);
      setPressed(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSettled(tripped);
    });
  };
  return (
    <li className="card-pad-x row-pad space-y-2">
      <div className="space-y-0.5">
        <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">{wire.question}</p>
        <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{tripwireMeta(wire)}</p>
      </div>
      <p className="text-ui text-ink [overflow-wrap:anywhere]">{`Reopen it if: ${wire.condition}`}</p>
      {settled === null ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Did it happen?">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={pending && pressed === true}
            disabled={pending}
            onClick={() => press(true)}
          >
            It happened
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={pending && pressed === false}
            disabled={pending}
            onClick={() => press(false)}
          >
            It did not
          </Button>
        </div>
      ) : (
        <p className="text-small text-ink-muted">
          {settled ? 'Reopened for the next meeting.' : 'Cleared. The decision stands.'}
        </p>
      )}
      <FieldError>{error}</FieldError>
    </li>
  );
}
