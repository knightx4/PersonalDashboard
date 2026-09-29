/**
 * Steps of yours the morning run has not judged for a Dash prep step yet
 * (plan #1217, under #1207).
 *
 * Dash judges each of your steps once: whether a draft, research or a list
 * written first would help you do it, and if so it adds a `claude` step
 * before it that prepares it (the goals skill, "A Dash step before yours").
 * The morning brief hands over the steps still unjudged, ten a morning,
 * newest first. A step judged to need nothing gets `prep_checked_at` all the
 * same, so it is not listed again, and the steps that were open before this
 * existed drain through the same list over the first mornings. A step you add
 * on the page waits here for the next morning run.
 *
 * Which steps are listed: a step of yours (`mine`), open, under an open goal
 * and reached through open steps only, with nothing open beneath it, whose
 * start date has come, not judged yet (`prep_checked_at` null), with nothing
 * prepared on it (no `result` or `result_url`) and no live prep step (a
 * `claude` step whose `prepares_id` names it and that is not dropped; a done
 * one counts). A phase with open sub-steps is left off: its sub-steps are
 * judged instead.
 *
 * Pure. The tree comes from loadLiveTree in lib/goals/steps-store.ts, which
 * leaves archived rows out.
 */
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** More than this many and the rest wait for tomorrow, so one run stays one sitting. */
export const PREP_CANDIDATE_LIMIT = 10;

export type PrepCandidate = {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  /** When the step was added, or null when the store did not read it. */
  createdAt: string | null;
};

/** The ids of the steps a live prep step already serves, in every goal's tree. */
function preparedIds(stepsByGoal: Map<string, StepNode[]>): Set<string> {
  const served = new Set<string>();
  const walk = (nodes: StepNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'claude' && node.preparesId && node.status !== 'dropped') {
        served.add(node.preparesId);
      }
      walk(node.children);
    }
  };
  for (const nodes of stepsByGoal.values()) walk(nodes);
  return served;
}

const hasOpenChild = (node: StepNode) =>
  node.children.some((child) => child.status === 'open' || child.status === 'blocked');

/**
 * Up to PREP_CANDIDATE_LIMIT steps of yours not judged yet, newest first.
 * `except` names steps listed elsewhere in the brief for another move (the
 * steps that have sat for a week), which are left off before the cap: the
 * move on a stale step already includes preparing it.
 */
export function prepCandidates(
  goals: Goal[],
  stepsByGoal: Map<string, StepNode[]>,
  except: ReadonlySet<string> = new Set(),
): PrepCandidate[] {
  const served = preparedIds(stepsByGoal);
  const found: PrepCandidate[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (node.waitsUntil) continue;
        if (
          node.kind === 'mine' &&
          !node.prepCheckedAt &&
          node.result === null &&
          node.resultUrl === null &&
          !hasOpenChild(node) &&
          !served.has(node.id) &&
          !except.has(node.id)
        ) {
          found.push({
            id: node.id,
            title: node.title,
            goalId: goal.id,
            goalTitle: goal.title,
            createdAt: node.createdAt ?? null,
          });
        }
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  // Newest first; a step with no known time goes last, in page order.
  const at = (c: PrepCandidate) => {
    const ms = c.createdAt ? Date.parse(c.createdAt) : Number.NaN;
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };
  return found
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => at(b.candidate) - at(a.candidate) || a.index - b.index)
    .map(({ candidate }) => candidate)
    .slice(0, PREP_CANDIDATE_LIMIT);
}

/** One step's line in the morning brief. */
export function prepLine(step: PrepCandidate): string {
  return `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}"`;
}
