/**
 * What the goals half of the runner is doing, for the Status panel on Dash.
 *
 * The runner works goals as well as the plan (decision #1006): each tick maps a
 * goal that needs it or works a ready Claude step. The Plan row on Dash read
 * only the plan, so a night busy on a goal said it was on nothing, and goal
 * steps waiting for it were not counted as ready.
 *
 * Two facts, read the way `inngest/goals/overnight.ts` reads them so the card
 * and the tick agree: the goal runs going now, whoever started them, and what
 * the next tick could pick up.
 *
 * Pure: the page loads the rows, this only reads them.
 */
import { chooseNightMaps, type NightGoal, type NightRun, type NightStep } from '@/lib/goals/overnight-choice';
import { runOutcome, type RunJob, type RunListing } from '@/lib/goals/runs';

/** A goal run going now, as the card names it. */
export type GoalOnLine = {
  id: string;
  /** What kind of run, as a phrase: "Mapping the goal", "Working the step". */
  doing: string;
  /** The goal or step it is on; null for a morning or weekly run. */
  title: string | null;
  at: string;
  /** What the session last said it was on. */
  nowOn: string | null;
};

export type GoalsStatus = {
  on: GoalOnLine[];
  /** Ready Claude steps no run is on yet. */
  readySteps: number;
  /** Goals the next ticks would map. */
  toMap: number;
};

const DOING: Record<RunJob, string> = {
  goal: 'Mapping the goal',
  daily: 'The morning goals run',
  weekly: 'The weekly goals run',
  reshape: 'Re-shaping after your answers',
  step: 'Working the goal step',
  phase: 'Working the goal phase',
  prepare: 'Preparing the goal step',
  area: 'Planning the area',
  raise: 'Answering your reply to a flag',
};

export function goalsStatus(input: {
  started: readonly RunListing[];
  night: { goals: readonly NightGoal[]; steps: readonly NightStep[]; runs: readonly NightRun[] };
  /** When the plan runner's night started, or null for none. */
  nightStartedAt: string | null;
  now: number;
}): GoalsStatus {
  const { started, night, now } = input;

  const on = started
    .filter((run) => runOutcome(run, now) === 'running')
    .map((run) => ({
      id: run.id,
      doing: DOING[run.job],
      title: run.area?.name ?? run.item?.title ?? null,
      at: run.createdAt,
      nowOn: run.nowOn,
    }));

  const busy = new Set(
    night.runs.filter((run) => runOutcome(run, now) === 'running').map((run) => run.stepId),
  );
  const readySteps = night.steps.filter((step) => !busy.has(step.id)).length;

  const toMap = chooseNightMaps({
    goals: night.goals,
    runs: night.runs,
    // Outside a night nothing has been mapped tonight, so the start is now.
    nightStartedAt: input.nightStartedAt ?? new Date(now).toISOString(),
    now,
  }).chosen.length;

  return { on, readySteps, toMap };
}

/** The ready half as words, or null when there is nothing ready in goals. */
export function goalsReadyLine(status: Pick<GoalsStatus, 'readySteps' | 'toMap'>): string | null {
  const parts: string[] = [];
  if (status.readySteps > 0) {
    parts.push(
      status.readySteps === 1 ? '1 goal step ready' : `${status.readySteps} goal steps ready`,
    );
  }
  if (status.toMap > 0) {
    parts.push(status.toMap === 1 ? '1 goal to map' : `${status.toMap} goals to map`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
