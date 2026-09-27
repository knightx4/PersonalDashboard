import Link from 'next/link';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { Meter } from '@/components/ui/meter';
import { formatDay } from '@/lib/goals/dates';
import { nextMove, type HomeGoal } from '@/lib/goals/home';
import { VERDICT_LABELS, type GoalReview, type Verdict } from '@/lib/goals/reviews';

/**
 * One open goal on the Goals home (plan #1077): its title, how far through
 * it is, Dash's status for the day, and the next move with its date. The
 * whole goal is one tap away on its page.
 */

export const VERDICT_TONES: Record<Verdict, DevTone> = {
  on_track: 'positive',
  stalled: 'caution',
  waiting_on_you: 'caution',
  waiting_on_date: 'quiet',
  waiting_on_goal: 'quiet',
  met: 'positive',
};

/**
 * A goal's status as one word, for a goal line or the top of a goal page. A
 * status older than a day and a half (isCurrent) says the day it was checked,
 * so a missed run does not pass for today's reading.
 */
export function VerdictLabel({ review, current }: { review: GoalReview; current: boolean }) {
  const checked = formatDay(review.createdAt.slice(0, 10));
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <StateLabel
        glyph={null}
        word={VERDICT_LABELS[review.verdict]}
        tone={VERDICT_TONES[review.verdict]}
        title={`Dash’s check, ${checked}: ${review.reason}`}
        className="text-small font-semibold"
      />
      {!current && <span className="text-small text-ink-ghost">as of {checked}</span>}
    </span>
  );
}

export function GoalLine({ line }: { line: HomeGoal }) {
  const { goal, progress, review } = line;
  const href = `/goals/${goal.id}`;
  const move = nextMove(line);
  return (
    <li className="card-pad-x row-pad space-y-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={href}
          className="min-w-0 text-ui font-semibold break-words text-ink underline-offset-2 hover:underline"
        >
          {goal.title}
        </Link>
        <span className="flex items-center gap-3">
          {progress.live > 0 && (
            <span className="flex items-center gap-2">
              <Meter
                value={progress.done}
                max={progress.live}
                fill="bg-positive"
                track="sunken"
                minFraction={0.04}
                label={`${goal.title}: ${progress.done} of ${progress.live} steps done`}
                className="w-16"
              />
              <span className="tabular text-small text-ink-muted">
                {progress.done} of {progress.live}
              </span>
            </span>
          )}
          {review && <VerdictLabel review={review} current={line.current} />}
        </span>
      </div>
      {move ? (
        <p className="text-small break-words text-ink-muted">
          Next: <span className="text-ink">{move.text}</span>
          {move.on && `, ${formatDay(move.on)}`}
        </p>
      ) : (
        <p className="text-small text-ink-muted">
          {line.hasSteps ? 'Nothing is next on you or Dash.' : 'No steps yet.'}{' '}
          <Link href={href} className="text-accent underline-offset-2 hover:underline">
            {line.hasSteps ? 'Open the goal' : 'Break it into steps'}
          </Link>
        </p>
      )}
    </li>
  );
}
