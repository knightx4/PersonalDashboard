/**
 * Which goal steps a night tick works, and in what order (plan #1007).
 *
 * The goals half of the shared overnight runner (decision #1006). The plan's
 * chooser in lib/plan/overnight-choice.ts picks one feature from the plan
 * tree; this picks goal steps from the ones `readyClaudeSteps` already found
 * ready, so it never re-derives readiness. It only orders and skips:
 *
 * - soonest due first, and a step with no due date after every one with one;
 * - then the goal that has gone longest without progress, a goal that has
 *   never made any counting as the longest;
 * - then the order the steps came in, which is page order.
 *
 * And it leaves out three kinds of step: one under a goal that already has a
 * run going, a second step of a goal this list already names, and one whose
 * last two runs both failed. A run that never reported back counts as failed
 * here, the same reading the Runs page gives it, since a session that died is
 * no likelier to finish the step the third time.
 *
 * Pure, and no database. The tick loads the rows; what "progress" means for a
 * goal is the caller's to say, as `lastProgressAt`.
 */
import type { ReadyStep } from '@/lib/goals/daily-run';
import { runOutcome, type RunJob } from '@/lib/goals/runs';
import type { GoalRunStatus } from '@/lib/goals/shaping';

/** A ready Claude step, with the due date the order reads. */
export type NightStep = ReadyStep & { dueOn: string | null };

/** A goals.runs row, reduced to what the choice reads. */
export type NightRun = {
  /** The goal the run was on, directly or through one of its steps. */
  goalId: string;
  /** The step it was on; null for a run on the goal itself. */
  stepId: string | null;
  status: GoalRunStatus;
  createdAt: string;
  /** The session's last report, which keeps a long run from reading as silent. */
  lastSeenAt?: string | null;
  /** What started it; `goal` is a mapping run (plan #1009). Absent reads as not a mapping run. */
  job?: RunJob;
};

export type NightSkipReason = 'goal_running' | 'goal_chosen' | 'failed_twice';

export type NightChoice = {
  /** The steps to work, in the order to work them; at most one per goal. */
  chosen: NightStep[];
  /** Every ready step left out, with why. */
  skipped: { step: NightStep; reason: NightSkipReason }[];
};

/** Whether a step's two most recent runs both failed or never reported back. */
function failedTwice(runs: readonly NightRun[], now: number): boolean {
  const latest = [...runs]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 2);
  if (latest.length < 2) return false;
  return latest.every((run) => {
    const outcome = runOutcome(run, now);
    return outcome === 'failed' || outcome === 'silent';
  });
}

export function chooseNightSteps(input: {
  steps: readonly NightStep[];
  runs: readonly NightRun[];
  /** Each goal's last progress, as an ISO instant; missing or null for never. */
  lastProgressAt: ReadonlyMap<string, string | null>;
  now: number;
}): NightChoice {
  const { steps, runs, lastProgressAt, now } = input;

  const running = new Set<string>();
  const runsByStep = new Map<string, NightRun[]>();
  for (const run of runs) {
    if (runOutcome(run, now) === 'running') running.add(run.goalId);
    if (run.stepId) runsByStep.set(run.stepId, [...(runsByStep.get(run.stepId) ?? []), run]);
  }

  const progress = (goalId: string) => {
    const at = lastProgressAt.get(goalId);
    return at ? Date.parse(at) : Number.NEGATIVE_INFINITY;
  };
  const ordered = steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const dueA = a.step.dueOn;
      const dueB = b.step.dueOn;
      if (dueA !== dueB) {
        if (dueA === null) return 1;
        if (dueB === null) return -1;
        return dueA < dueB ? -1 : 1;
      }
      const stale = progress(a.step.goalId) - progress(b.step.goalId);
      if (stale !== 0 && !Number.isNaN(stale)) return stale;
      return a.index - b.index;
    })
    .map(({ step }) => step);

  const chosen: NightStep[] = [];
  const skipped: NightChoice['skipped'] = [];
  const taken = new Set<string>();
  for (const step of ordered) {
    if (running.has(step.goalId)) skipped.push({ step, reason: 'goal_running' });
    else if (failedTwice(runsByStep.get(step.id) ?? [], now))
      skipped.push({ step, reason: 'failed_twice' });
    else if (taken.has(step.goalId)) skipped.push({ step, reason: 'goal_chosen' });
    else {
      chosen.push(step);
      taken.add(step.goalId);
    }
  }
  return { chosen, skipped };
}

/**
 * A live goal, as the night reads it to decide whether to map it (plan #1009).
 */
export type NightGoal = {
  id: string;
  title: string;
  status: 'proposed' | 'open' | 'done' | 'dropped';
  /** When you approved its map, or null before you have. */
  approvedAt: string | null;
  createdAt: string;
  /** When its fog was last written or cleared by anyone but Claude, or null for never. */
  fogChangedAt: string | null;
};

/** Why a goal is mapped tonight: it has never been mapped, or its fog changed since it was. */
export type NightMapReason = 'new' | 'fog';

export type NightMapSkipReason = 'goal_running' | 'mapped_tonight';

export type NightMapChoice = {
  /** The goals to map, oldest trigger first. */
  chosen: { goal: NightGoal; reason: NightMapReason }[];
  /** Goals that wanted a map but are not getting one on this tick, with why. */
  skipped: { goal: NightGoal; reason: NightMapSkipReason }[];
};

const after = (a: string | null, b: string | null) =>
  a !== null && (b === null || Date.parse(a) > Date.parse(b));

/**
 * Whether a goal wants a map, and why; null when it does not.
 *
 * Only an open goal: a goal Claude proposed waits for you to take it before
 * anything is built under it. A goal with no finished mapping run wants one,
 * unless you approved it anyway. After that only a change to its fog brings
 * it back, and on an approved goal only a change made since you approved it.
 * Claude writing its own fog is not a change: that is the map's output.
 */
function mapReason(goal: NightGoal, lastMappedAt: string | null): NightMapReason | null {
  if (goal.status !== 'open') return null;
  if (goal.approvedAt !== null) {
    return after(goal.fogChangedAt, goal.approvedAt) && after(goal.fogChangedAt, lastMappedAt)
      ? 'fog'
      : null;
  }
  if (lastMappedAt === null) return 'new';
  return after(goal.fogChangedAt, lastMappedAt) ? 'fog' : null;
}

/**
 * Which goals a night tick maps (plan #1009): a goal never mapped, or one
 * whose fog changed since it was, at most one mapping run per goal per night.
 *
 * A mapping run is a goals.runs row with job `goal`, the same run "Work on
 * this" starts. Only a finished one counts as a map made, so a failed or
 * silent one is tried again the next night; any one started since the night
 * began counts against tonight, whatever became of it.
 */
export function chooseNightMaps(input: {
  goals: readonly NightGoal[];
  runs: readonly NightRun[];
  /** When tonight's runner was started, as an ISO instant. */
  nightStartedAt: string;
  now: number;
}): NightMapChoice {
  const { goals, runs, nightStartedAt, now } = input;
  const nightStart = Date.parse(nightStartedAt);

  const running = new Set<string>();
  const tonight = new Set<string>();
  const lastMapped = new Map<string, string>();
  for (const run of runs) {
    if (runOutcome(run, now) === 'running') running.add(run.goalId);
    if (run.job !== 'goal') continue;
    if (Date.parse(run.createdAt) >= nightStart) tonight.add(run.goalId);
    if (run.status !== 'done') continue;
    const seen = lastMapped.get(run.goalId);
    if (!seen || Date.parse(run.createdAt) > Date.parse(seen)) lastMapped.set(run.goalId, run.createdAt);
  }

  const wanted = goals
    .map((goal) => ({ goal, reason: mapReason(goal, lastMapped.get(goal.id) ?? null) }))
    .filter((one): one is { goal: NightGoal; reason: NightMapReason } => one.reason !== null)
    .map((one) => ({
      ...one,
      since: Date.parse(one.reason === 'new' ? one.goal.createdAt : (one.goal.fogChangedAt as string)),
    }))
    .sort((a, b) => a.since - b.since);

  const chosen: NightMapChoice['chosen'] = [];
  const skipped: NightMapChoice['skipped'] = [];
  for (const { goal, reason } of wanted) {
    if (tonight.has(goal.id)) skipped.push({ goal, reason: 'mapped_tonight' });
    else if (running.has(goal.id)) skipped.push({ goal, reason: 'goal_running' });
    else chosen.push({ goal, reason });
  }
  return { chosen, skipped };
}
