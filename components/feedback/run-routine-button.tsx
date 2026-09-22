'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Play, TriangleAlert } from 'lucide-react';
import {
  routineRun,
  runFeatureRoutine,
  type FeedbackActionState,
  type RoutineRun,
} from '@/app/dev/bugs/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { notesLastRunLine, type NotesLastRun } from '@/lib/feedback/last-worked';

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
/**
 * How long it has been going, in the largest unit that is still true.
 *
 * Minutes for a batch, hours once it is clearly not one. No seconds: they
 * would be a number moving on the screen while nothing is happening, and the
 * question here is "is this still going", not "how fast".
 */
function elapsed(since: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}

/** Enough of the note to recognise it, on one line. */
function trim(body: string): string {
  const line = body.trim().replace(/\s+/g, ' ');
  return line.length > 70 ? `${line.slice(0, 69)}…` : line;
}

export function RunRoutineButton({
  openCount,
  allHref,
  onNavigate,
  divider = 'top',
  lastRun,
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
   *
   * `none` is for a caller that has already drawn the separation -- the Status
   * panel on Dash puts one rule between its rows, and a second from in here
   * would be a line under a line.
   */
  divider?: 'top' | 'bottom' | 'none';
  /**
   * What the last run did, as `notesLastRun` infers it. Passed by the Status
   * panel on Dash, where the row otherwise has nothing to say between runs.
   * Omitted elsewhere.
   */
  lastRun?: NotesLastRun | null;
}) {
  const [state, action, pending] = useActionState(runFeatureRoutine, {} as FeedbackActionState);

  /**
   * Whether a run is already working the queue.
   *
   * `pending` covers the second it takes to fire the routine and nothing after
   * it, so the button went back to looking idle while a batch ran for half an
   * hour -- and the only way to find out was to press it again. Polled rather
   * than pushed: the run happens somewhere else entirely and this page has no
   * connection to it, and a note claimed a few seconds late costs nothing.
   */
  const [run, setRun] = useState<RoutineRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const justFired = state.message;

  useEffect(() => {
    let live = true;
    const read = () => {
      void routineRun()
        .then((next) => {
          if (live) setRun(next);
        })
        // A failed poll leaves the last answer standing. It is a status line,
        // and being briefly out of date beats replacing it with an error.
        .catch(() => {});
    };

    read();
    const poll = setInterval(read, 20_000);
    // Only the minute needs to be right, but a tick well inside it keeps the
    // number from visibly lagging the clock.
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      live = false;
      clearInterval(poll);
      clearInterval(tick);
    };
    // Re-read as soon as a press reports back: the note it claims is the first
    // thing that changes, and waiting out the poll would show "not running"
    // immediately after starting one.
  }, [justFired]);

  const running = run !== null && !run.stale;

  return (
    <form
      action={action}
      className={cn(
        'space-y-2 border-border',
        divider === 'top' && 'border-t pt-4',
        divider === 'bottom' && 'border-b pb-4',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Not disabled while a run is going: the queue is worked by a routine
            somewhere else, and this page is only inferring. Taking the control
            away on an inference is worse than saying what it thinks is true and
            leaving the decision -- the button says the run is already going, so
            pressing it is a choice rather than an accident. */}
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          <Play className="size-3.5" aria-hidden />
          {pending ? 'Starting…' : running ? 'Run it again anyway' : 'Run Feature Routine'}
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
      {run === null && lastRun && (
        <p className="text-ui text-ink-muted">
          <span className="text-ink">Last ran {elapsed(lastRun.at, now)} ago</span>:{' '}
          {notesLastRunLine(lastRun)}.
        </p>
      )}
      {run === null && !lastRun && (
        <p className="text-ui text-ink-muted">
          Works the outstanding notes now instead of waiting for the schedule.
        </p>
      )}

      {running && run && (
        <p className="flex items-start gap-2 text-ui text-ink-muted">
          <Loader2
            className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
            aria-hidden
          />
          <span className="min-w-0">
            <span className="text-ink">Running for {elapsed(run.since, now)}</span> — working “
            {trim(run.note)}”.
          </span>
        </p>
      )}

      {/* Said rather than swallowed: a note left claimed is the queue holding
          something nobody is working on, and it is the reader who has to
          decide whether to run it again. */}
      {run !== null && run.stale && (
        <p className="flex items-start gap-2 text-ui text-ink-muted">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-caution" aria-hidden />
          <span className="min-w-0">
            “{trim(run.note)}” has been in progress for {elapsed(run.since, now)}, so the run that
            claimed it has most likely stopped without closing it.
          </span>
        </p>
      )}
      {/* Ink, not green: law 4 keeps positive for money coming back, and this
          is the routine saying it started. */}
      {state.message && <p className="text-ui text-ink-muted">{state.message}</p>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
