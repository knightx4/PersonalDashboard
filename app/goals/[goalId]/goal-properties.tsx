import { Property, PropertyList } from '@/components/shell/detail-layout';
import { formatDay } from '@/lib/goals/dates';
import { formatDue } from '@/lib/goals/due-precision';
import { lastActiveWords, paceHint, paceWords, type GoalPace } from '@/lib/goals/pace';
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
  goal: Pick<Goal, 'areaId' | 'status' | 'dueOn' | 'duePrecision' | 'createdAt' | 'closedAt' | 'errand'>;
  areaName: string;
  review: GoalReview | null;
  progress: Pick<GoalProgress, 'live' | 'done' | 'bands'>;
  timeZone: string;
  /** How often something happens on the goal (plan #1737); null on a closed goal or an errand. */
  pace?: GoalPace | null;
};

/**
 * Whether Last active sits with the facts read first (plan #1737): when the
 * goal has one and the glance would otherwise hold fewer than three facts,
 * so a goal with no verdict or no steps yet still shows on a phone's first
 * screen when anything last happened on it.
 */
export function lastActiveFirst(
  review: GoalReview | null,
  progress: Pick<GoalProgress, 'live'>,
  pace: GoalPace | null,
): boolean {
  if (!pace || lastActiveWords(pace) === null) return false;
  return 1 + (review ? 1 : 0) + (progress.live > 0 ? 1 : 0) < 3;
}

/**
 * The goal's facts read first (plan #1688): the status, Dash's verdict and
 * the progress, and Last active where there is room (`lastActiveFirst`). One
 * row on a phone, with the rest under "All details"; the head of the column
 * from laptop width.
 */
export function GoalGlance({
  goal,
  review,
  progress,
  pace = null,
}: Pick<Props, 'goal' | 'review' | 'progress' | 'pace'>) {
  const last = lastActiveFirst(review, progress, pace) && pace ? lastActiveWords(pace) : null;
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
      {last && <Property label="Last active" value={last} />}
    </>
  );
}

/** The day it closed, and the open steps split between you and Dash. */
function goalFacts(
  goal: Props['goal'],
  progress: Props['progress'],
  timeZone: string,
): { closed: string | null; split: string } {
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
  return { closed, split };
}

/** How many facts `GoalProperties` draws, said on the closed fold on a phone. */
export function goalDetailCount(
  goal: Props['goal'],
  progress: Props['progress'],
  timeZone: string,
  pace: GoalPace | null = null,
  review: GoalReview | null = null,
): number {
  const { closed, split } = goalFacts(goal, progress, timeZone);
  const last = pace && lastActiveWords(pace) && !lastActiveFirst(review, progress, pace);
  const pacing = pace ? 1 + (last ? 1 : 0) : 0;
  return 1 + (goal.dueOn ? 1 : 0) + (closed ? 1 : 0) + (split ? 1 : 0) + pacing;
}

/**
 * The rest of the goal's facts in the tabbed detail's properties (plan
 * #1671): the area, the dates, the open steps split between you and
 * Dash, and the goal's usual pace (plan #1737). The split is the steps'
 * bands from `goalProgress`, the same counts the goal's bar on Goals draws,
 * so the two never disagree. When it was added is the line under the title
 * (`goalLine`).
 */
export function GoalProperties({ goal, areaName, review, progress, timeZone, pace = null }: Props) {
  const { closed, split } = goalFacts(goal, progress, timeZone);
  // Last active is said once: in the glance when it went there.
  const last = pace && !lastActiveFirst(review, progress, pace) ? lastActiveWords(pace) : null;
  return (
    <PropertyList>
      {/* Plain text, as the feature page's Module is: the path above the
          title already goes to the area. */}
      <Property label="Area" value={areaName} />
      {goal.dueOn && <Property label="Due" value={formatDue(goal.dueOn, goal.duePrecision)} />}
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
      {pace && (
        <Property
          label="Usual pace"
          // "Not enough to tell yet" is too long for half the phone's grid.
          wide={!pace.known}
          hint={paceHint(pace)}
          value={paceWords(pace)}
        />
      )}
      {last && <Property label="Last active" value={last} />}
    </PropertyList>
  );
}
