import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { DashCredit } from '@/components/ui/dash-mark';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { stepHref } from '@/lib/goals/all-goals';
import { formatDay } from '@/lib/goals/dates';
import type { ClosedStep } from '@/lib/goals/goal-page';
import type { GoalRunRow } from '@/lib/goals/runs';
import { threadRef } from '@/lib/thread/subjects';
import { dayIn } from '@/lib/todo/time';
import { RunHistory } from './goal-shaping';

/**
 * The goal page's Activity tab (plan #1671): what happened to the goal. The
 * steps closed, newest first, each going to its own page; the goal's last
 * runs; and its comments, where you write to Dash about the whole goal.
 */
export function GoalActivity({
  goalId,
  closed,
  runs,
  moreRuns,
  thread,
  timeZone,
}: {
  goalId: string;
  closed: readonly ClosedStep[];
  runs: GoalRunRow[];
  moreRuns: boolean;
  thread: DevComment[];
  timeZone: string;
}) {
  return (
    <div className="space-y-6">
      {closed.length > 0 && (
        <section aria-labelledby="closed-heading" className="space-y-2">
          <h2 id="closed-heading" className="px-1 text-ui font-semibold text-ink">
            Steps closed
          </h2>
          {/* On a card, as every list on the tabbed page is (plan #1686). */}
          <Card padding="dense" className="py-1">
            <ul className="divide-y divide-border">
              {closed.map((step) => (
                <li
                  key={step.id}
                  className="flex items-baseline gap-3 py-1.5 text-small max-sm:min-h-11 max-sm:items-center"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {step.dash && <DashCredit />}
                    <Link
                      href={stepHref(goalId, step.id)}
                      className={
                        step.status === 'dropped'
                          ? 'press-area text-ink-muted line-through decoration-ink-muted/60 hover:text-ink'
                          : 'press-area text-ink hover:text-accent'
                      }
                    >
                      {step.title}
                    </Link>
                  </span>
                  <span className="tabular shrink-0 text-ink-muted">
                    {step.status === 'dropped' ? 'Dropped' : 'Done'}{' '}
                    {formatDay(dayIn(step.closedAt, timeZone))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
      {runs.length > 0 && (
        <section aria-label="Runs">
          <Card padding="dense">
            <RunHistory runs={runs} more={moreRuns} />
          </Card>
        </section>
      )}
      {closed.length === 0 && runs.length === 0 && (
        <Card padding="dense">
          <p className="text-small text-ink-muted">
            No step has closed and Dash has not run on this goal yet.
          </p>
        </Card>
      )}
      {/* The goal's own thread (plan #957). Each step has its own, on its
          page. One frame: `onCard` drops the thread's own well. */}
      <Card padding="dense">
        <Thread
          subject={threadRef('goal', goalId)}
          turns={thread}
          onCard
          label="Comment on this goal"
          placeholder="A note on the goal. Tag @dash to ask about it, or to give it figures to file."
        />
      </Card>
    </div>
  );
}
