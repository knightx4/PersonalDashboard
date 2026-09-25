/**
 * What the Goals home shows on the daily visit (docs/GOALS-SPEC.md, "The
 * daily view"; plan #926), sorted by whose move it is.
 *
 * Three lists, all read out of the step trees already built by buildForest:
 *
 * - For each active goal, the next one to three things for you to do.
 * - What else is waiting on you, each in one of three groups: decide (a
 *   question, a flag), approve (goals Claude proposed, grouped by area, and a
 *   breakdown), and read (a result Claude produced, and the context and
 *   drafts it found, which the loader adds).
 * - What Dash has in hand: Claude steps ready for the next run, and Claude
 *   steps held until you approve what they sit under. The loader adds the
 *   runs going now.
 *
 * Pure, so the ordering and the cap are tested without a database, in the
 * way lib/plan/waiting.ts is for the dev plan's Dash section.
 */
import { isStaleStepBlock, waitsOnNothing } from '@/lib/goals/dependencies';
import type { GoalReview } from '@/lib/goals/reviews';
import type { GoalProgress } from '@/lib/goals/status';
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
  /** Its bar and whose move it is (plan #958); added by the loader, not by dailyView. */
  progress?: GoalProgress;
  /** The weekly run's newest verdict on the goal (plan #1018), when there is one. */
  review?: GoalReview;
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
  /**
   * Goals Claude proposed in one area, as one row: `id` is the area, `title`
   * its name, and `goalId` the first goal, which a single proposal opens to.
   */
  | {
      kind: 'plan';
      id: string;
      title: string;
      goalId: string;
      goalTitle: string;
      count: number;
      goals: { id: string; title: string }[];
    }
  | { kind: 'review'; id: string; title: string; goalId: string; goalTitle: string }
  /** Something a run flagged on the goal (plan #1015); `id` is the raised_items row. */
  | { kind: 'flag'; id: string; title: string; goalId: string; goalTitle: string }
  /** Context Claude found in the other modules, waiting on Keep or Not relevant; `id` is the goal. */
  | { kind: 'context'; id: string; title: string; goalId: string; goalTitle: string; count: number }
  /** Records Claude filled as drafts, waiting to be confirmed; `id` is the goal. */
  | { kind: 'drafts'; id: string; title: string; goalId: string; goalTitle: string; count: number };

/** What each waiting item asks of you, which is how the home groups them. */
export type WaitingGroup = 'decide' | 'approve' | 'read';

export const WAITING_GROUP: Record<WaitingItem['kind'], WaitingGroup> = {
  question: 'decide',
  flag: 'decide',
  plan: 'approve',
  breakdown: 'approve',
  review: 'read',
  context: 'read',
  drafts: 'read',
};

/** A Claude step with nothing in its way, which the next scheduled run works. */
export type DashReady = { id: string; title: string; goalId: string; goalTitle: string };

/**
 * Claude steps that wait on your approval: under a goal Claude proposed
 * (`goal`), or proposed themselves under a goal you approved (`steps`).
 */
export type DashHeld = { goalId: string; goalTitle: string; count: number; on: 'goal' | 'steps' };

/** A run going now, as the home names it; added by the loader, which reads goals.runs. */
export type DashRunning = { id: string; label: string; on: string | null; progress: string | null };

export type DashQueue = { ready: DashReady[]; held: DashHeld[]; running?: DashRunning[] };

/**
 * The context and drafts waiting on each goal, as rows for the read group.
 * `counts` are keyed by goal id; goals with none, or not in `titles`, are
 * left out.
 */
export function readWaiting(
  context: ReadonlyMap<string, number>,
  drafts: ReadonlyMap<string, number>,
  titles: ReadonlyMap<string, string>,
): WaitingItem[] {
  const rows: WaitingItem[] = [];
  for (const [goalId, goalTitle] of titles) {
    const found = context.get(goalId) ?? 0;
    if (found > 0) rows.push({ kind: 'context', id: goalId, title: goalTitle, goalId, goalTitle, count: found });
    const filled = drafts.get(goalId) ?? 0;
    if (filled > 0) rows.push({ kind: 'drafts', id: goalId, title: goalTitle, goalId, goalTitle, count: filled });
  }
  return rows;
}

export type DailyView = { goals: DailyGoal[]; waiting: WaitingItem[]; dash: DashQueue };

type GoalWithArea = { goal: Goal; areaName: string };

/**
 * Most pressing first. A question holds up whatever sits above it in the
 * tree. A flag is a thing that already happened out in the world, such as a
 * moved due date, and it can cost money while it waits. A breakdown holds up a
 * goal that has none yet. A result to read holds nothing up, but it is what
 * the morning run was for; a proposed goal holds up nothing until you want it.
 */
const WAITING_ORDER: Record<WaitingItem['kind'], number> = {
  question: 0,
  flag: 1,
  breakdown: 2,
  review: 3,
  context: 4,
  drafts: 5,
  plan: 6,
};

/**
 * Rows read from outside the step trees, merged into the waiting list in its
 * order. The flags on a goal (plan #1015) live in public.raised_items, so
 * dailyView never sees them. The sort is stable, so rows of one kind keep the
 * order they came in.
 */
export function withWaiting(
  waiting: readonly WaitingItem[],
  more: readonly WaitingItem[],
): WaitingItem[] {
  return [...waiting, ...more].sort((a, b) => WAITING_ORDER[a.kind] - WAITING_ORDER[b.kind]);
}

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
 * not read is still listed as waiting. A step of yours is next when it has no
 * open step beneath it: a step with open sub-steps waits on them, and it is
 * they that are next. A Claude step in the same place is ready for Dash's
 * next run instead, and a Claude step inside a proposal, or under a goal
 * Claude proposed, is held until you approve it.
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
  const ready: DashReady[] = [];
  const held: DashHeld[] = [];
  const plans = new Map<string, Extract<WaitingItem, { kind: 'plan' }>>();
  // Where each row came in the walk, which is page order then tree order.
  const seen = new Map<object, number>();
  const order = (row: object) => seen.get(row) ?? 0;
  const place = <T extends object>(row: T): T => {
    seen.set(row, seen.size);
    return row;
  };

  for (const { goal, areaName } of goals) {
    if (goal.status === 'proposed') {
      const plan = plans.get(goal.areaId);
      if (plan) {
        plan.count += 1;
        plan.goals.push({ id: goal.id, title: goal.title });
      } else {
        const row = place({
          kind: 'plan' as const,
          id: goal.areaId,
          title: areaName,
          goalId: goal.id,
          goalTitle: goal.title,
          count: 1,
          goals: [{ id: goal.id, title: goal.title }],
        });
        plans.set(goal.areaId, row);
        waiting.push(row);
      }
      const claude = countClaude(stepsByGoal.get(goal.id) ?? []);
      if (claude > 0) held.push({ goalId: goal.id, goalTitle: goal.title, count: claude, on: 'goal' });
      continue;
    }
    if (goal.status !== 'open') continue;

    const roots = stepsByGoal.get(goal.id) ?? [];
    const candidates: NextItem[] = [];
    // Steps whose date has passed: ranked as due today, shown undated.
    const overdue = new Set<string>();
    let proposed = 0;
    let heldClaude = 0;

    const walk = (nodes: StepNode[], under: string | null) => {
      for (const node of nodes) {
        if (node.status === 'proposed') {
          proposed += 1 + countProposed(node.children);
          heldClaude += countClaude([node]);
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
        if (node.status !== 'open' && !isStaleStepBlock(node)) continue;

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
        } else if (node.kind === 'claude' && waitsOnNothing(node)) {
          // Claude's own: it goes on Dash's list, not yours.
          ready.push(place({ id: node.id, title: node.title, goalId: goal.id, goalTitle: goal.title }));
        } else if (node.kind === 'mine' && waitsOnNothing(node)) {
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

    if (heldClaude > 0) {
      held.push({ goalId: goal.id, goalTitle: goal.title, count: heldClaude, on: 'steps' });
    }
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
  return { goals: daily, waiting, dash: { ready, held } };
}

/** The earliest due date first, undated after dated. A tie is left to the order of the tree. */
function compareNext(a: NextItem, b: NextItem): number {
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

/** Claude steps anywhere in these branches that are not closed. */
function countClaude(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'claude' && node.status !== 'done' && node.status !== 'dropped') count += 1;
    count += countClaude(node.children);
  }
  return count;
}
