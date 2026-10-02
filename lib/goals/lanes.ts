/**
 * The Dash and Later lanes on the Goals home. The first lane, On you, is
 * Up next's ranked list (lib/goals/today.ts).
 *
 * - Dash has it: Dash's open steps that can start (not proposed, not waiting
 *   on a start date), with whether a run is on the step or its goal now, and
 *   what the step needs from you when it is blocked on you. Steps of yours
 *   that Dash is preparing now come first, since they are what you handed
 *   over most recently.
 * - Later: steps whose own start date is still ahead, which is where Not now
 *   puts a step. Only the highest such step in a branch is listed; the steps
 *   under it wait with it. Soonest first.
 *
 * Pure, so the lanes are tested without a database. The reads are in
 * lib/goals/home-store.ts.
 */
import { isGoing } from '@/lib/goals/hand-off';
import type { RunListing } from '@/lib/goals/runs';
import { askedOfYou } from '@/lib/goals/today';
import type { StepNode } from '@/lib/goals/steps';

export type DashLaneItem = {
  /** The step. */
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  /** `preparing` for a step of yours Dash is preparing; `step` for Dash's own. */
  kind: 'step' | 'preparing';
  /** Whether a run is on this step, or on its goal, now. */
  working: boolean;
  /** The question it is blocked on, when it waits on you. */
  needs: string | null;
};

export type LaterLaneItem = {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  /** YYYY-MM-DD it comes back. */
  startsOn: string;
  /** YYYY-MM-DD it is due, or null. */
  dueOn: string | null;
};

type GoalRef = { goal: { id: string; title: string; status: string } };

const isLive = (node: StepNode) => node.status === 'open' || node.status === 'blocked';

export function dashLane(input: {
  goals: readonly GoalRef[];
  byGoal: ReadonlyMap<string, readonly StepNode[]>;
  runs: readonly RunListing[];
  now: number;
}): DashLaneItem[] {
  const going = input.runs.filter((run) => isGoing(run, input.now));
  const busyGoals = new Set(
    going.filter((run) => run.item?.level === 'goal').map((run) => run.item!.id),
  );
  const busySteps = new Set(
    going.filter((run) => run.item?.level === 'step').map((run) => run.item!.id),
  );
  const preparing = new Set(
    going.filter((run) => run.job === 'prepare' && run.item).map((run) => run.item!.id),
  );

  const first: DashLaneItem[] = [];
  const rest: DashLaneItem[] = [];
  for (const { goal } of input.goals) {
    if (goal.status !== 'open') continue;
    const walk = (list: readonly StepNode[]) => {
      for (const node of list) {
        if (node.status === 'proposed' || node.waitsUntil || !isLive(node)) continue;
        const base = { id: node.id, title: node.title, goalId: goal.id, goalTitle: goal.title };
        if (node.kind === 'mine' && preparing.has(node.id)) {
          first.push({ ...base, kind: 'preparing', working: true, needs: null });
        } else if (node.kind === 'claude') {
          const blockedOnYou = node.status === 'blocked' && node.blockKind === 'outside';
          rest.push({
            ...base,
            kind: 'step',
            working: busySteps.has(node.id) || busyGoals.has(goal.id),
            needs: blockedOnYou ? (askedOfYou(node.blockAsk) ?? node.blockAsk ?? null) : null,
          });
        }
        walk(node.children);
      }
    };
    walk(input.byGoal.get(goal.id) ?? []);
  }
  // A run going on a step lists it first among Dash's own.
  rest.sort((a, b) => Number(b.working) - Number(a.working));
  return [...first, ...rest];
}

export function laterLane(input: {
  goals: readonly GoalRef[];
  byGoal: ReadonlyMap<string, readonly StepNode[]>;
  today: string;
}): LaterLaneItem[] {
  const out: LaterLaneItem[] = [];
  for (const { goal } of input.goals) {
    if (goal.status !== 'open') continue;
    const walk = (list: readonly StepNode[]) => {
      for (const node of list) {
        if (node.status === 'proposed' || !isLive(node)) continue;
        if (node.startsOn && node.startsOn > input.today) {
          out.push({
            id: node.id,
            title: node.title,
            goalId: goal.id,
            goalTitle: goal.title,
            startsOn: node.startsOn,
            dueOn: node.dueOn,
          });
          continue;
        }
        walk(node.children);
      }
    };
    walk(input.byGoal.get(goal.id) ?? []);
  }
  return out.sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0));
}
