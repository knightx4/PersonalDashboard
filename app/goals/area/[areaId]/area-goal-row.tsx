import Link from 'next/link';
import { ListTree } from 'lucide-react';
import { StateLabel } from '@/components/dev/state-label';
import type { DailyGoal } from '@/lib/goals/daily';
import { formatDay } from '@/lib/goals/dates';
import { VERDICT_LABELS, type GoalReview } from '@/lib/goals/reviews';
import { GoalProgress } from '../../goal-progress';
import { VERDICT_TONES } from '../../goal-line';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * One goal: its bar, its status and the way into its tree. Listed
 * under its area, so the area is not repeated on the row.
 */
export function GoalRow({ daily }: { daily: DailyGoal }) {
  const { goal, more, next, hasSteps, progress, review } = daily;
  const tree = `/goals/${goal.id}`;
  const steps = next.length + more;
  const treeLabel = !hasSteps
    ? 'Break into steps'
    : steps > 0
      ? `${plural(steps, 'step')} of yours · Full tree`
      : 'Full tree';
  return (
    <li className="card-pad-x row-pad space-y-0.5">
      <p className="text-ui font-semibold break-words text-ink">
        <Link href={tree} className="press-area underline-offset-2 hover:underline">
          {goal.title}
        </Link>
      </p>
      {progress && <GoalProgress progress={progress} label={goal.title} />}
      {review && <ReviewLine review={review} />}
      <Link
        href={tree}
        className="press-area inline-flex items-center gap-1.5 text-small text-ink-muted transition-colors duration-quick hover:text-ink"
      >
        <ListTree className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {treeLabel}
      </Link>
    </li>
  );
}

/**
 * The goal's newest status (plans #1018, #1074): the verdict and why on one
 * line, the next move and its date on the next. A stalled goal's next move is
 * also a proposed step, which Your move above offers to approve.
 */
function ReviewLine({ review }: { review: GoalReview }) {
  const checked = formatDay(review.createdAt.slice(0, 10));
  return (
    <div className="space-y-0.5 pt-1 text-small break-words text-ink-muted">
      <p>
        <StateLabel
          glyph={null}
          word={VERDICT_LABELS[review.verdict]}
          tone={VERDICT_TONES[review.verdict]}
          title={`Dash’s check, ${checked}`}
          className="mr-1.5 font-semibold"
        />
        {review.reason}
      </p>
      <p>
        Next: {review.nextMove}
        {review.nextOn && ` (${formatDay(review.nextOn)})`}
      </p>
    </div>
  );
}
