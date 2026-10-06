import { FileBody } from '@/components/files/file-body';
import { Card } from '@/components/ui/card';
import { DashCredit } from '@/components/ui/dash-mark';
import { Disclosure } from '@/components/ui/disclosure';
import type { Brief } from '@/lib/goals/briefs';
import { formatDay } from '@/lib/goals/dates';
import type { GoalReview } from '@/lib/goals/reviews';
import { VerdictLabel } from '../goal-line';

/**
 * Where the goal stands, under its title (plan #1078): Dash's verdict and one
 * line of counts ("3 on you · Dash on 1 · due 31 Oct", `statusLine` in
 * lib/goals/goal-status.ts), the verdict's next move as a sentence, Dash's
 * latest note folded, what Dash is on, and Ask Dash. The page puts the
 * goal's number and Waiting on you straight under it.
 */

export type GoalStatusCardProps = {
  /** The line of counts, from `statusLine`. */
  line: string;
  review: GoalReview | null;
  /** Whether that status is recent enough to stand as today's (isCurrent). */
  current: boolean;
  brief: Brief | null;
  /** When the note was written, to follow "written": "today", "on 3 Oct". */
  briefWhen: string | null;
  /** What Dash is on under the goal, and what it finished in the last day. */
  work?: React.ReactNode;
  /** Ask Dash on the whole goal, while it has nothing to approve. */
  ask?: React.ReactNode;
};

export function GoalStatusCard({
  line,
  review,
  current,
  brief,
  briefWhen,
  work,
  ask,
}: GoalStatusCardProps) {
  return (
    <section aria-labelledby="status-heading">
      <Card padding="standard" className="space-y-2">
        <h2 id="status-heading" className="sr-only">
          Where it stands
        </h2>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-small text-ink-muted">
          {review && <VerdictLabel review={review} current={current} />}
          <span className="tabular">{line}</span>
        </p>
        {review ? (
          <p className="text-ui text-ink">
            {review.nextMove}
            {review.nextOn && (
              <span className="tabular text-ink-muted"> · {formatDay(review.nextOn)}</span>
            )}
          </p>
        ) : (
          <p className="text-ui text-ink-muted">Dash has not checked this goal yet.</p>
        )}
        {brief && (
          <Disclosure
            title={
              <>
                <DashCredit />
                Dash’s note
              </>
            }
            meta={briefWhen ? `written ${briefWhen}` : undefined}
          >
            <FileBody markdown={brief.body} compact />
          </Disclosure>
        )}
        {work}
        {ask}
      </Card>
    </section>
  );
}
