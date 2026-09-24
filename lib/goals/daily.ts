/**
 * What the Goals home shows on the daily visit (docs/GOALS-SPEC.md, "The
 * daily view"; plan #926).
 *
 * Two lists, both read out of the step trees already built by buildForest:
 *
 * - For each active goal, the next one to three things to do, yours before
 *   Claude's.
 * - What is waiting on you: a question to answer, a breakdown to approve, a
 *   goal Claude proposed, and a result Claude produced for you to read
 *   (plan #933).
 *
 * Pure, so the ordering and the cap are tested without a database, in the
 * way lib/plan/waiting.ts is for the dev plan's Dash section.
 */
import type { StepKind, StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** The most next items a goal shows on the home. The rest are in its tree. */
export const NEXT_PER_GOAL = 3;

export type NextItem = {
  id: string;
  title: string;
  kind: Extract<StepKind, 'mine' | 'claude'>;
  /**
   * YYYY-MM-DD, or null when undated or already past: an overdue step comes
   * back as an ordinary next item with no date on it (plan #935).
   */
  dueOn: string | null;
  /** The step it sits under, when that is a step rather than the goal. */
  under: string | null;
};

export type DailyGoal = {
  goal: Goal;
  areaName: string;
  next: NextItem[];
  /** Next items left out by the cap. */
  more: number;
  /** Whether the goal has any live steps at all, so the page can offer a breakdown. */
  hasSteps: boolean;
};

export type WaitingItem =
  | { kind: 'question'; id: string; title: string; goalId: string; goalTitle: string }
  | {
      kind: 'breakdown';
      id: string;
      title: string;
      goalId: string;
      goalTitle: string;
      count: number;
    }
  | { kind: 'goal'; id: string; title: string; goalId: string; goalTitle: string }
  | { kind: 'review'; id: string; title: string; goalId: string; goalTitle: string };

export type DailyView = { goals: DailyGoal[]; waiting: WaitingItem[] };

type GoalWithArea = { goal: Goal; areaName: string };

/**
 * Most pressing first. A question holds up whatever sits above it in the
 * tree; a breakdown holds up a goal that has none yet. A result to read holds
 * nothing up, but it is what the morning run was for; a proposed goal holds
 * up nothing until you want it.
 */
const WAITING_ORDER: Record<WaitingItem['kind'], number> = {
  question: 0,
  breakdown: 1,
  review: 2,
  goal: 3,
};

/**
 * The daily view for `goals`, which arrive in page order (area, then goal),
 * with each goal's live steps from buildForest.
 *
 * A goal is active while it is open. A proposed goal is waiting on you
 * instead, and its steps are part of that proposal, so none of them shows.
 * Done and dropped goals are left off the home.
 *
 * Within an open goal the walk goes only through open steps. A proposed step
 * and everything under it is the breakdown to approve; a done or dropped step
 * takes its branch with it, although a Claude step with a result you have
 * not read is still listed as waiting. A step is next when it is yours or Claude's and
 * has no open step beneath it: a step with open sub-steps waits on them, and
 * it is they that are next.
 *
 * After time away nothing piles up (docs/GOALS-SPEC.md, "Coming back after
 * time away"): a due date before `today` is ranked as though it were today
 * and not shown, so a step missed a fortnight ago sits among what is due now
 * rather than leading the page with a debt.
 */
export function dailyView(
  goals: GoalWithArea[],
  stepsByGoal: Map<string, StepNode[]>,
  today: string,
): DailyView {
  const daily: DailyGoal[] = [];
  const waiting: WaitingItem[] = [];
  // Where each row came in the walk, which is page order then tree order.
  const seen = new Map<object, number>();
  const order = (row: object) => seen.get(row) ?? 0;
  const place = <T extends object>(row: T): T => {
    seen.set(row, seen.size);
    return row;
  };

  for (const { goal, areaName } of goals) {
    if (goal.status === 'proposed') {
      waiting.push(
        place({
          kind: 'goal',
          id: goal.id,
          title: goal.title,
          goalId: goal.id,
          goalTitle: goal.title,
        }),
      );
      continue;
    }
    if (goal.status !== 'open') continue;

    const roots = stepsByGoal.get(goal.id) ?? [];
    const candidates: NextItem[] = [];
    // Steps whose date has passed: ranked as due today, shown undated.
    const overdue = new Set<string>();
    let proposed = 0;

    const walk = (nodes: StepNode[], under: string | null) => {
      for (const node of nodes) {
        if (node.status === 'proposed') {
          proposed += 1 + countProposed(node.children);
          continue;
        }
        if (awaitsReview(node)) {
          waiting.push(
            place({
              kind: 'review',
              id: node.id,
              title: node.title,
              goalId: goal.id,
              goalTitle: goal.title,
            }),
          );
        }
        if (node.status !== 'open') continue;

        if (node.kind === 'decision') {
          if (node.resolution === null && !node.dismissedAt) {
            waiting.push(
              place({
                kind: 'question',
                id: node.id,
                title: node.title,
                goalId: goal.id,
                goalTitle: goal.title,
              }),
            );
          }
        } else if (
          (node.kind === 'mine' || node.kind === 'claude') &&
          !node.children.some((child) => child.status === 'open')
        ) {
          if (node.dueOn !== null && node.dueOn < today) overdue.add(node.id);
          candidates.push(
            place({
              id: node.id,
              title: node.title,
              kind: node.kind,
              dueOn: node.dueOn !== null && node.dueOn < today ? today : node.dueOn,
              under,
            }),
          );
        }
        walk(node.children, node.title);
      }
    };
    walk(roots, null);

    if (proposed > 0) {
      waiting.push(
        place({
          kind: 'breakdown',
          id: goal.id,
          title: goal.title,
          goalId: goal.id,
          goalTitle: goal.title,
          count: proposed,
        }),
      );
    }

    const next = candidates.sort((a, b) => compareNext(a, b) || order(a) - order(b));
    daily.push({
      goal,
      areaName,
      next: next
        .slice(0, NEXT_PER_GOAL)
        .map((item) => (overdue.has(item.id) ? { ...item, dueOn: null } : item)),
      more: Math.max(0, next.length - NEXT_PER_GOAL),
      hasSteps: roots.length > 0,
    });
  }

  waiting.sort((a, b) => WAITING_ORDER[a.kind] - WAITING_ORDER[b.kind] || order(a) - order(b));
  return { goals: daily, waiting };
}

/**
 * Yours before Claude's, then the earliest due date, undated after dated. A
 * tie is left to the order of the tree.
 */
function compareNext(a: NextItem, b: NextItem): number {
  if (a.kind !== b.kind) return a.kind === 'mine' ? -1 : 1;
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  return 0;
}

/**
 * A Claude step whose result you have not marked read. It is usually done,
 * since a Claude step closes once its result is stored; a dropped one is not
 * worth reading.
 */
export function awaitsReview(node: StepNode): boolean {
  return (
    node.kind === 'claude' &&
    node.status !== 'dropped' &&
    node.reviewedAt === null &&
    (node.result !== null || node.resultUrl !== null)
  );
}

function countProposed(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === 'proposed') count += 1 + countProposed(node.children);
  }
  return count;
}
