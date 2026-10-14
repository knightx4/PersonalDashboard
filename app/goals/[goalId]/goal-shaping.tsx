'use client';

import { useActionState } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { LiveDot } from '@/components/ui/live-dot';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { useRunRefresh } from '@/components/runs/use-run-refresh';
import { Card } from '@/components/ui/card';
import type { GoalRunRow } from '@/lib/goals/runs';
import {
  approveGoalAction,
  workOnGoalAction,
  type ShapingActionState,
} from './shaping-actions';
import { LinkedText } from '@/components/ui/linked-text';

const initial: ShapingActionState = {};

/**
 * Claude on this goal (plan #932): whether you have approved it, what Claude
 * has proposed and asked, its last ten runs (plan #1014), and the two presses.
 * Ask Dash fires the goals routine for this goal (askDash's goal run, the same
 * control a step's row has); Approve opens what it proposed
 * and lets it change the steps here without asking from then on. With nothing
 * to approve it is one line rather than a card.
 *
 * On the goal page (plan #1078) it is `quiet`: with nothing to approve it is
 * Ask Dash alone, in the status card, and the runs are listed under More.
 */
export function GoalShaping({
  goalId,
  approval,
  runs,
  moreRuns,
  running: progress,
  canRun,
  quiet = false,
}: {
  goalId: string;
  approval: { text: string; approve: string | null };
  /** The goal's latest runs, newest first, each opening to what it changed (plan #1014). */
  runs: GoalRunRow[];
  /** Whether it has older runs than these, which the Runs page lists. */
  moreRuns: boolean;
  /**
   * Where the run still going has got to, as "on Draft the letter, 3 minutes
   * ago" (plan #1002), or null when none is going.
   */
  running: string | null;
  /** Whether this account can start a run (the owner's only). */
  canRun: boolean;
  /** Leave out the approval line while there is nothing to approve, and the run history always. */
  quiet?: boolean;
}) {
  const running = progress !== null;
  useRunRefresh(running);
  const [approveState, approve, approving] = useActionState(approveGoalAction, initial);
  const [workState, work, starting] = useActionState(workOnGoalAction, initial);
  const error = approveState.error ?? workState.error;
  const message = workState.message ?? approveState.message;

  const status = running && (
    <p role="status" className="flex items-center gap-1.5 text-small text-accent">
      <LiveDot />
      <span>Dash is on it · {progress}</span>
    </p>
  );
  const history = !quiet && runs.length > 0 && <RunHistory runs={runs} more={moreRuns} />;
  const text = quiet && !approval.approve ? '' : approval.text;
  const workButton = canRun && (
    <form action={work}>
      <input type="hidden" name="goalId" value={goalId} />
      <Button
        type="submit"
        variant={approval.approve ? 'secondary' : 'primary'}
        pending={starting}
        disabled={running}
      >
        Ask Dash
      </Button>
    </form>
  );
  const feedback = error ? (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  ) : (
    message && (
      <p role="status" className="text-small text-ink-muted">
        {message}
      </p>
    )
  );

  // Nothing to approve: the run line and Ask Dash as one line, with no
  // heading or card around them (ui finding 133242ff, plan #1038). The card
  // comes back when Claude proposes something.
  if (!approval.approve) {
    if (!text && !status && !history && !workButton && !feedback) return null;
    return (
      <div className="space-y-1 px-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* A basis, so on a phone the button drops under the lines instead
              of squeezing them into a column beside it. */}
          <div className="min-w-0 flex-[1_1_18rem] space-y-0.5">
            {text && <p className="text-ui text-ink">{text}</p>}
            {status}
          </div>
          {workButton}
        </div>
        {feedback}
        {history}
      </div>
    );
  }

  return (
    <section aria-labelledby="claude-heading" className="space-y-2">
      <h2 id="claude-heading" className="px-1 text-ui font-semibold text-ink">
        Dash on this goal
      </h2>
      <Card className="space-y-2 p-3">
        <p className="text-ui text-ink">{approval.text}</p>
        {status}
        <div className="flex flex-wrap items-center gap-2">
          <form action={approve}>
            <input type="hidden" name="goalId" value={goalId} />
            <Button type="submit" pending={approving}>
              {approval.approve}
            </Button>
          </form>
          {workButton}
        </div>
        {feedback}
        {history}
      </Card>
    </section>
  );
}

/**
 * The goal's runs, newest first (plan #1014): what started each, how it
 * ended and when, and its summary or its error. Each opens to its own page,
 * which lists what it changed; the Runs page has the older ones.
 */
export function RunHistory({ runs, more }: { runs: GoalRunRow[]; more: boolean }) {
  return (
    <div className="space-y-1 pt-1">
      <h3 className="text-small font-semibold text-ink">Runs</h3>
      <ul className="divide-y divide-border">
        {runs.map((run) => (
          <li key={run.id} className="space-y-0.5 py-1.5">
            <p className="text-small break-words">
              <Link
                href={`/goals/runs/${run.id}`}
                className="font-medium text-ink hover:underline"
              >
                {run.label}
              </Link>
              <span className={run.failed ? 'text-danger' : 'text-ink-muted'}> · {run.meta}</span>
            </p>
            {run.text && (
              <p
                className={`line-clamp-2 text-small break-words whitespace-pre-wrap ${run.failed ? 'text-danger' : 'text-ink'}`}
              >
                <LinkedText text={run.text} />
              </p>
            )}
          </li>
        ))}
      </ul>
      {more && (
        <Link href="/goals/runs" className={cn('text-small', linkVariants({ tone: 'quiet' }))}>
          All runs
        </Link>
      )}
    </div>
  );
}
