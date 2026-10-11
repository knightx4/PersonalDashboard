import { Property, PropertyList } from '@/components/shell/detail-layout';
import { formatDay } from '@/lib/goals/dates';
import { VERDICT_LABELS, type GoalReview } from '@/lib/goals/reviews';
import type { GoalProgress } from '@/lib/goals/status';
import type { Goal, GoalStatus } from '@/lib/goals/tree';
import { dayIn } from '@/lib/todo/time';

const STATUS_WORD: Record<GoalStatus, string> = {
  proposed: 'Proposed',
  open: 'Open',
  parked: 'Parked',
  done: 'Done',
  dropped: 'Dropped',
};

/** "3 Oct" for an instant, read as a day in the account's zone. */
function dayOf(iso: string | null | undefined, timeZone: string): string | null {
  return iso ? formatDay(dayIn(iso, timeZone)) : null;
}

/**
 * The goal's facts in the tabbed detail's properties column (plan #1671),
 * as the feature page has its own: the area, the status, Dash's verdict, the
 * dates, and the progress split between you and Dash. The split is the
 * steps' bands from `goalProgress`, the same counts the goal's bar on Goals
 * draws, so the two never disagree.
 */
export function GoalProperties({
  goal,
  areaName,
  review,
  progress,
  timeZone,
}: {
  goal: Pick<Goal, 'areaId' | 'status' | 'dueOn' | 'createdAt' | 'closedAt' | 'errand'>;
  areaName: string;
  review: GoalReview | null;
  progress: Pick<GoalProgress, 'live' | 'done' | 'bands'>;
  timeZone: string;
}) {
  const added = dayOf(goal.createdAt, timeZone);
  const closed =
    goal.status === 'done' || goal.status === 'dropped' ? dayOf(goal.closedAt, timeZone) : null;
  // The open steps split between you and Dash, leaving out a share of none:
  // "3 yours · 1 Dash’s · 1 waiting".
  const split = [
    progress.bands.on_you > 0 && `${progress.bands.on_you} yours`,
    progress.bands.with_dash > 0 && `${progress.bands.with_dash} Dash’s`,
    progress.bands.waiting > 0 && `${progress.bands.waiting} waiting`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <PropertyList>
      {/* Plain text, as the feature page's Module is: the path above the
          title already goes to the area. */}
      <Property label="Area" value={areaName} />
      <Property
        label="Status"
        value={goal.errand ? `${STATUS_WORD[goal.status]} errand` : STATUS_WORD[goal.status]}
      />
      {review && (
        <Property
          label="Dash’s verdict"
          hint={review.reason}
          value={VERDICT_LABELS[review.verdict]}
        />
      )}
      {goal.dueOn && <Property label="Due" value={formatDay(goal.dueOn, true)} />}
      {added && <Property label="Added" value={added} />}
      {closed && (
        <Property label={goal.status === 'dropped' ? 'Dropped' : 'Finished'} value={closed} />
      )}
      {progress.live > 0 && (
        <Property
          label="Progress"
          wide
          hint="Steps and sub-steps that count, questions included; proposed and dropped ones left out. Yours: your move. Dash’s: Dash is on them or can take them. Waiting: on another step or a date."
          value={
            <span className="block">
              <span className="block">{`${progress.done} of ${progress.live} done`}</span>
              {split && (
                <span className="block whitespace-normal text-small text-ink-muted">{split}</span>
              )}
            </span>
          }
        />
      )}
    </PropertyList>
  );
}
