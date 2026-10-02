import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { formatDay } from '@/lib/goals/dates';
import { VERDICT_LABELS, type GoalReview, type Verdict } from '@/lib/goals/reviews';

/**
 * A goal's status from Dash's daily check, as the goal board's cards
 * (goal-board.tsx), the area page and the top of a goal page draw it.
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
