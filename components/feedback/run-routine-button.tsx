'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import {
  runFeatureRoutine,
  type FeedbackActionState,
} from '@/app/shopping/feedback/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/**
 * Start the routine that works this queue.
 *
 * One shape, two placements: at the top of the feedback page, and in its own
 * section at the bottom of the capture panel — the two moments where wanting
 * the queue worked actually occurs. It used to be a bare link squeezed onto
 * the panel's Send row, where it read as a footnote to the form rather than as
 * the other thing you can do from there.
 *
 * On the page it sat under the whole list, which meant scrolling past every
 * note to reach the button that works them; the count beside it already says
 * what the list would have said.
 *
 * The count beside it is what makes the button answerable: "run the routine" is
 * a different decision when eleven notes are waiting than when none are.
 *
 * A way through to the whole queue belongs on that same row, for the same
 * reason: "12 open issues" is the sentence that makes someone want to look at
 * them. It is passed in rather than assumed, because the feedback page renders
 * this too and has no use for a link back to itself.
 */
export function RunRoutineButton({
  openCount,
  allHref,
  onNavigate,
  divider = 'top',
}: {
  /** Outstanding notes, shown beside the button. Omitted while unknown. */
  openCount?: number | null;
  /** Where the full queue lives. Omitted when this is already that page. */
  allHref?: string;
  onNavigate?: () => void;
  /**
   * Which side the rule that separates this from the list is on. It follows
   * the placement: below the list the rule is above, above the list it is
   * below. A section with a rule on the wrong side reads as belonging to
   * whatever is on the other side of it.
   */
  divider?: 'top' | 'bottom';
}) {
  const [state, action, pending] = useActionState(
    runFeatureRoutine,
    {} as FeedbackActionState,
  );

  return (
    <form
      action={action}
      className={cn(
        'space-y-2 border-border',
        divider === 'top' ? 'border-t pt-4' : 'border-b pb-4',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          <Play className="size-3.5" aria-hidden />
          {pending ? 'Starting…' : 'Run Feature Routine'}
        </Button>
        {openCount != null && (
          <span className="text-ui text-ink-muted">
            {openCount} open issue{openCount === 1 ? '' : 's'}
          </span>
        )}
        {allHref && (
          <Link
            href={allHref}
            onClick={onNavigate}
            className="ml-auto text-ui text-accent hover:underline"
          >
            See all
          </Link>
        )}
      </div>
      <p className="text-ui text-ink-muted">
        Works the outstanding notes now instead of waiting for the schedule.
      </p>
      {state.message && <p className="text-ui text-positive">{state.message}</p>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
