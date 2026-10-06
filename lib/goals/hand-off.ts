/**
 * Who holds each goal, and what Dash could take next, for the Goals home.
 *
 * goalHolders counts, on each goal, how much of it is on you and whether
 * Dash is on it, which the offers below read: the things on you ranked,
 * Dash's open steps, and the run going on it now, if any.
 *
 * Put Dash to work offers a few things to hand over in one press, so that
 * deciding what Dash should do is a choice between named options rather than
 * a blank box:
 *
 * - Prepare one of your steps: the first steps of yours in Up next's order
 *   that Dash has not prepared yet and is not preparing now. A prepare run
 *   writes a draft, a script or a checklist onto the step, which stays yours
 *   (plan #1001).
 * - Work on a goal Dash has left alone: a goal with no run going, no open
 *   step of Dash's, and no run on it or its steps in QUIET_DAYS. A stalled
 *   goal comes first, then the one least far through.
 *
 * Pure, so the counts and the picks are tested without a database. The reads
 * are in lib/goals/home-store.ts.
 */
import type { HomeGoal } from '@/lib/goals/home';
import type { RunListing } from '@/lib/goals/runs';
import { runIsQuiet } from '@/lib/goals/shaping';
import type { StepNode } from '@/lib/goals/steps';
import type { TodayItem } from '@/lib/goals/today';

/** How long a goal goes without Dash before it is offered as one Dash could work. */
export const QUIET_DAYS = 7;

/** The most of each kind of offer, so the section stays a short pick. */
export const PREPARE_OFFERS = 2;
export const GOAL_OFFERS = 2;

export type GoalHolders = {
  /** Things on you in this goal: Up next and what is folded under it. */
  onYou: number;
  /** Dash's open steps in it. */
  dashOpen: number;
  /** The run going on it or one of its steps now, or null. */
  working: RunListing | null;
  /** When Dash last started a run on it or its steps, or null when never. */
  lastDashAt: string | null;
};

export type DashOffer =
  | { kind: 'prepare'; stepId: string; title: string; goalId: string; goalTitle: string }
  | { kind: 'goal'; goalId: string; title: string; reason: string };

/** Whether a started run is still taken to be going (shaping.ts's rule, on a listing). */
export function isGoing(run: RunListing, now: number): boolean {
  return run.status === 'started' && !runIsQuiet(run, now);
}

/** Every step id in a goal's tree, mapped to the goal. */
function goalOfSteps(byGoal: ReadonlyMap<string, readonly StepNode[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [goalId, roots] of byGoal) {
    const walk = (list: readonly StepNode[]) => {
      for (const node of list) {
        out.set(node.id, goalId);
        walk(node.children);
      }
    };
    walk(roots);
  }
  return out;
}

/** The goal a run was on, through its step when it was on one; null for a morning or area run. */
export function runGoal(run: RunListing, steps: ReadonlyMap<string, string>): string | null {
  if (!run.item) return null;
  if (run.item.level === 'goal') return run.item.id;
  return steps.get(run.item.id) ?? null;
}

function countDashOpen(roots: readonly StepNode[]): number {
  let count = 0;
  const walk = (list: readonly StepNode[]) => {
    for (const node of list) {
      if (node.status === 'dropped' || node.status === 'done' || node.status === 'proposed') continue;
      if (node.kind === 'claude' && !node.waitsUntil) count += 1;
      walk(node.children);
    }
  };
  walk(roots);
  return count;
}

/**
 * Each open goal's holders, by goal id. `onYou` is everything ranked as on
 * you (Up next and the folded list); `runs` are the recent runs, newest first.
 */
export function goalHolders(input: {
  goals: readonly Pick<HomeGoal, 'goal'>[];
  byGoal: ReadonlyMap<string, readonly StepNode[]>;
  onYou: readonly Pick<TodayItem, 'goalId'>[];
  runs: readonly RunListing[];
  now: number;
}): Map<string, GoalHolders> {
  const steps = goalOfSteps(input.byGoal);
  const out = new Map<string, GoalHolders>();
  for (const { goal } of input.goals) {
    out.set(goal.id, {
      onYou: 0,
      dashOpen: countDashOpen(input.byGoal.get(goal.id) ?? []),
      working: null,
      lastDashAt: null,
    });
  }
  for (const item of input.onYou) {
    const holders = out.get(item.goalId);
    if (holders) holders.onYou += 1;
  }
  for (const run of input.runs) {
    const goalId = runGoal(run, steps);
    const holders = goalId ? out.get(goalId) : undefined;
    if (!holders) continue;
    if (!holders.lastDashAt || run.createdAt > holders.lastDashAt) holders.lastDashAt = run.createdAt;
    if (!holders.working && isGoing(run, input.now)) holders.working = run;
  }
  return out;
}

function stepIndex(byGoal: ReadonlyMap<string, readonly StepNode[]>): Map<string, StepNode> {
  const out = new Map<string, StepNode>();
  const walk = (list: readonly StepNode[]) => {
    for (const node of list) {
      out.set(node.id, node);
      walk(node.children);
    }
  };
  for (const roots of byGoal.values()) walk(roots);
  return out;
}

function daysSince(iso: string, now: number): number {
  return Math.floor((now - Date.parse(iso)) / 86_400_000);
}

/**
 * The steps on you that Dash could prepare: steps of yours with no sub-steps,
 * nothing prepared on them yet, and no prepare run going on them. In the
 * order given.
 */
export function preparableSteps(input: {
  byGoal: ReadonlyMap<string, readonly StepNode[]>;
  onYou: readonly Pick<TodayItem, 'kind' | 'id'>[];
  runs: readonly RunListing[];
  now: number;
}): string[] {
  const nodes = stepIndex(input.byGoal);
  const preparing = new Set(
    input.runs
      .filter((run) => run.job === 'prepare' && run.item && isGoing(run, input.now))
      .map((run) => run.item!.id),
  );
  return input.onYou
    .filter((item) => {
      if (item.kind !== 'step') return false;
      const node = nodes.get(item.id);
      if (!node || node.kind !== 'mine' || node.result || preparing.has(node.id)) return false;
      return !node.children.some((child) => child.kind !== 'decision');
    })
    .map((item) => item.id);
}

/** What Put Dash to work offers, prepares first. */
export function dashOffers(input: {
  goals: readonly Pick<HomeGoal, 'goal' | 'review' | 'progress'>[];
  byGoal: ReadonlyMap<string, readonly StepNode[]>;
  /** Everything on you, in Up next's order. */
  onYou: readonly TodayItem[];
  holders: ReadonlyMap<string, GoalHolders>;
  runs: readonly RunListing[];
  now: number;
}): DashOffer[] {
  const { now } = input;
  const ready = new Set(preparableSteps(input).slice(0, PREPARE_OFFERS));
  const prepares: DashOffer[] = input.onYou
    .filter((item) => ready.has(item.id))
    .map((item) => ({
      kind: 'prepare',
      stepId: item.id,
      title: item.title,
      goalId: item.goalId,
      goalTitle: item.goalTitle,
    }));

  const quiet = input.goals
    .filter(({ goal }) => {
      if (goal.status !== 'open') return false;
      const holders = input.holders.get(goal.id);
      if (!holders || holders.working || holders.dashOpen > 0) return false;
      return !holders.lastDashAt || daysSince(holders.lastDashAt, now) >= QUIET_DAYS;
    })
    .sort((a, b) => {
      const stalled = (line: typeof a) => (line.review?.verdict === 'stalled' ? 0 : 1);
      const through = (line: typeof a) =>
        line.progress.live > 0 ? line.progress.done / line.progress.live : 0;
      return stalled(a) - stalled(b) || through(a) - through(b);
    })
    .slice(0, GOAL_OFFERS)
    .map(({ goal, review }): DashOffer => {
      const last = input.holders.get(goal.id)?.lastDashAt ?? null;
      const away = last
        ? `Dash has not worked on it in ${daysSince(last, now)} days`
        : 'Dash has not worked on it yet';
      return {
        kind: 'goal',
        goalId: goal.id,
        title: goal.title,
        reason: review?.verdict === 'stalled' ? `Stalled. ${away}.` : `${away}.`,
      };
    });

  return [...prepares, ...quiet];
}
