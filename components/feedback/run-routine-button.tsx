'use client';

import { useActionState, useState, useTransition } from 'react';
import { Play } from 'lucide-react';
import {
  runFeatureRoutine,
  type FeedbackActionState,
} from '@/app/shopping/feedback/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

/**
 * Start the routine that works this queue.
 *
 * Two placements, one action: under the whole list on the feedback page, and
 * in the capture panel next to "See all" — the two moments where wanting the
 * queue worked actually occurs.
 */
export function RunRoutineButton({
  variant = 'block',
}: {
  /** `block` under the queue; `inline` beside a link in the capture panel. */
  variant?: 'block' | 'inline';
}) {
  const [state, action, pending] = useActionState(
    runFeatureRoutine,
    {} as FeedbackActionState,
  );

  // The capture panel is itself a form, and a form inside a form is not
  // markup — so inline calls the action directly instead of submitting one.
  if (variant === 'inline') {
    return <InlineRunButton />;
  }

  return (
    <form action={action} className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          <Play className="size-3.5" aria-hidden />
          {pending ? 'Starting…' : 'Run Feature Routine'}
        </Button>
        <p className="text-ui text-ink-muted">
          Works the outstanding notes now instead of waiting for the schedule.
        </p>
      </div>
      {state.message && <p className="text-ui text-positive">{state.message}</p>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

function InlineRunButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FeedbackActionState>({});

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        title="Start the routine that works the queue"
        onClick={() =>
          startTransition(async () => {
            setState(await runFeatureRoutine({}, new FormData()));
          })
        }
        className="text-ui text-accent hover:underline disabled:opacity-60"
      >
        {pending ? 'Starting…' : 'Run routine'}
      </button>
      {state.message && <span className="text-small text-ink-muted">Started</span>}
      {state.error && (
        <span className="text-small text-danger" title={state.error}>
          Failed
        </span>
      )}
    </span>
  );
}
