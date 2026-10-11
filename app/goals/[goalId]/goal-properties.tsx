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
 * The one line under the goal's title (plan #1688), as a feature's says
 * "Feature #925" and who added it: what kind of thing it is, and when it was
 * added. The area is the crumb above the title, so it is not said again.
 */
export function goalLine(
  goal: Pick<Goal, 'createdAt' | 'errand'>,
  timeZone: string,
): string {
  const kind = goal.errand ? 'Errand' : 'Goal';
  const added = dayOf(goal.createdAt, timeZone);
  return added ? `${kind}, added ${added}` : kind;
}

type Props = {
  goal: Pick<Goal, 'areaId' | 'status' | 'dueOn' | 'createdAt' | 'closedAt' | 'errand'>;
  areaName: string;
  review: GoalReview | null;
  progress: Pick<GoalProgress, 'live' | 'done' | 'bands'>;
  timeZone: string;
};

/**
 * The goal's facts read first (plan #1688): the status, Dash's verdict and
 * the progress. One row on a phone, with the rest under "All details"; the
 * head of the column from laptop width.
 */
export function GoalGlance({ goal, review, progress }: Pick<Props, 'goal' | 'review' | 'progress'>) {
  return (
    <>
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
      {progress.live > 0 && (
        <Property
          label="Progress"
          hint="Steps and sub-steps that count, questions included; proposed and dropped ones left out."
          value={`${progress.done} of ${progress.live} done`}
        />
      )}
    </>
  );
}

/**
 * The rest of the goal's facts in the tabbed detail's properties (plan
 * #1671): the area, the dates, and the open steps split between you and
 * Dash. The split is the steps' bands from `goalProgress`, the same counts
 * the goal's bar on Goals draws, so the two never disagree. When it was
 * added is the line under the title (`goalLine`).
 */
export function GoalProperties({ goal, areaName, progress, timeZone }: Props) {
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
      {goal.dueOn && <Property label="Due" value={formatDay(goal.dueOn, true)} />}
      {closed && (
        <Property label={goal.status === 'dropped' ? 'Dropped' : 'Finished'} value={closed} />
      )}
      {split && (
        <Property
          label="Open steps"
          wide
          hint="Yours: your move. Dash’s: Dash is on them or can take them. Waiting: on another step or a date."
          value={split}
        />
      )}
    </PropertyList>
  );
}
