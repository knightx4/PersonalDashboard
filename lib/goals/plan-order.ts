/**
 * The order a goal's open steps are done in (plan #2778.5): what is on you
 * now, what comes next, and what waits beyond that and on what. The Plan tab
 * lists the three lanes, the Dashboard's strip names the first of each, and
 * the Goals home, the Inbox and Todo read `shownOutside` so that nothing
 * further down a goal's plan shows away from its page (plan #2778.6).
 *
 * - **Now** is the one or two open steps of yours that nothing holds back.
 *   The first is a question to answer, else a step due within a week (the
 *   earliest first), else the first in the order of the tree; a second joins
 *   it only when it too is a question or due within a week, so a goal reads
 *   as one thing in hand, as both approved mockups draw it.
 * - **Up next** is the following few that could start today, yours or
 *   Dash's, in the same order.
 * - **Later** is every other open step in the order of the tree, each with
 *   what it waits on: a start date, another step, a block only you or
 *   someone else can clear, or its rhythm.
 *
 * Only steps that stand for themselves are listed. A step with open steps
 * under it is done by doing those, so it is its sub-steps that are listed; a
 * proposed step and what is under it is a breakdown waiting on approval, and
 * a question put aside with Not now is out of view, as on the tree. A step
 * whose sub-steps are all closed is finished in all but its tick, so it is
 * left out too.
 *
 * Pure: the page passes in the goal's tree as loadGoalMap built it, with its
 * dependencies and start dates marked.
 */
import { formatDay } from '@/lib/goals/dates';
import { isStaleStepBlock, isStepReady } from '@/lib/goals/dependencies';
import type { StepNode } from '@/lib/goals/steps';

export type PlanLane = 'now' | 'next' | 'later';

/** Whose move a step is: yours to do, yours to answer, or Dash's. */
export type PlanWhose = 'you' | 'question' | 'dash';

/**
 * What a step that cannot start yet waits on, as its chip says it.
 * `date` is a start date ahead, `step` another step still open, `person` a
 * block someone has to clear, and `rhythm` a step kept up rather than done.
 */
export type PlanWait = { kind: 'date' | 'step' | 'person' | 'rhythm'; label: string };

export type PlanEntry = {
  id: string;
  node: StepNode;
  lane: PlanLane;
  /** 1-based, counting down Now, Up next and Later in turn. */
  number: number;
  whose: PlanWhose;
  /** The top-level step it sits under, which is its stage on a goal in stages; null at the top. */
  stage: { id: string; title: string } | null;
  /** The step directly above it, when that is not the stage. */
  under: string | null;
  /** What holds it back: always set in Later (a ready step there waits on its turn), null in Now and Up next. */
  waits: PlanWait | null;
};

export type PlanOrder = {
  now: PlanEntry[];
  next: PlanEntry[];
  later: PlanEntry[];
};

/** The most steps Now holds. */
export const NOW_MAX = 2;
/** The most steps Up next holds; the rest of the ready ones go to Later. */
export const NEXT_MAX = 3;
/** How many of Later the Plan tab lists before Show all. */
export const LATER_SHOWN = 8;

const LIVE = new Set(['open', 'blocked']);
const CLOSED = new Set(['done', 'dropped']);

const PERIOD: Record<string, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

function whoseOf(node: StepNode): PlanWhose {
  if (node.kind === 'decision') return 'question';
  if (node.kind === 'claude') return 'dash';
  return 'you';
}

/** Whether it is out of view on the plan: a question answered or put aside. */
function outOfView(node: StepNode): boolean {
  return node.kind === 'decision' && (node.resolution !== null || Boolean(node.dismissedAt));
}

/** Its own block, or the first one above it that only you or someone else can clear. */
function blockOf(
  node: StepNode,
  ancestors: readonly StepNode[],
): PlanWait | null {
  const held = [node, ...[...ancestors].reverse()].find(
    (step) => step.status === 'blocked' && !isStaleStepBlock(step),
  );
  if (!held) return null;
  const ask = held.blockAsk?.trim();
  // The ask as written: it often opens with a name, which lowering would spoil.
  return { kind: 'person', label: ask || 'Blocked' };
}

function waitOf(node: StepNode, ancestors: readonly StepNode[]): PlanWait | null {
  if (node.kind === 'rhythm') {
    return { kind: 'rhythm', label: PERIOD[node.rhythmPeriod ?? ''] ?? 'Kept up' };
  }
  if (node.waitsUntil) return { kind: 'date', label: `Starts ${formatDay(node.waitsUntil)}` };
  const first = node.waitingOn?.[0];
  if (first) return { kind: 'step', label: `After “${first.title}”` };
  return blockOf(node, ancestors);
}

type Leaf = {
  node: StepNode;
  ancestors: StepNode[];
  /** Tree order. */
  index: number;
};

/** The open steps that stand for themselves, in tree order, each with the steps above it. */
function leaves(steps: readonly StepNode[]): Leaf[] {
  const out: Leaf[] = [];
  const walk = (nodes: readonly StepNode[], ancestors: StepNode[]) => {
    for (const node of nodes) {
      if (!LIVE.has(node.status) || outOfView(node)) continue;
      // A step whose sub-steps are all closed is finished in all but its tick.
      if (node.children.length > 0 && node.children.every((child) => CLOSED.has(child.status))) continue;
      const before = out.length;
      walk(node.children, [...ancestors, node]);
      if (out.length === before) out.push({ node, ancestors, index: out.length });
    }
  };
  walk(steps, []);
  return out.map((leaf, index) => ({ ...leaf, index }));
}

/** YYYY-MM-DD, `days` after `day`. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** How near a due date has to be for a step to come before the order of the tree. */
export const SOON_DAYS = 7;

/**
 * The order within a lane: questions, then the steps due within a week (or
 * overdue) by date, then everything else in the order of the tree.
 */
function comparer(soonBy: string | null) {
  const rank = (leaf: Leaf) =>
    leaf.node.kind === 'decision' ? 0 : soon(leaf, soonBy) ? 1 : 2;
  return (a: Leaf, b: Leaf): number => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1 && a.node.dueOn !== b.node.dueOn) return a.node.dueOn! < b.node.dueOn! ? -1 : 1;
    return a.index - b.index;
  };
}

function soon(leaf: Leaf, soonBy: string | null): boolean {
  return soonBy !== null && leaf.node.dueOn !== null && leaf.node.dueOn <= soonBy;
}

/**
 * The goal's open steps in the three lanes. `today` (YYYY-MM-DD, the
 * account's) is what makes a due date near; without it dates do not reorder.
 */
export function planOrder(
  steps: readonly StepNode[],
  { today = null }: { today?: string | null } = {},
): PlanOrder {
  const all = leaves(steps);
  const soonBy = today ? addDays(today, SOON_DAYS) : null;
  const compare = comparer(soonBy);
  const ready = (leaf: Leaf) =>
    leaf.node.kind !== 'rhythm' && isStepReady(leaf.node, leaf.ancestors);
  const yours = (leaf: Leaf) => leaf.node.kind === 'mine' || leaf.node.kind === 'decision';
  const pressing = (leaf: Leaf) => leaf.node.kind === 'decision' || soon(leaf, soonBy);

  // The first step of yours, and a second only when it presses too.
  const nowLeaves = all
    .filter((leaf) => ready(leaf) && yours(leaf))
    .sort(compare)
    .slice(0, NOW_MAX)
    .filter((leaf, i) => i === 0 || pressing(leaf));
  const inNow = new Set(nowLeaves);
  const nextLeaves = all
    .filter((leaf) => !inNow.has(leaf) && ready(leaf))
    .sort(compare)
    .slice(0, NEXT_MAX);
  const taken = new Set([...nowLeaves, ...nextLeaves]);
  const laterLeaves = all.filter((leaf) => !taken.has(leaf));

  let number = 0;
  const entry =
    (lane: PlanLane) =>
    (leaf: Leaf): PlanEntry => {
      const top = leaf.ancestors[0] ?? null;
      const parent = leaf.ancestors.at(-1) ?? null;
      number += 1;
      return {
        id: leaf.node.id,
        node: leaf.node,
        lane,
        number,
        whose: whoseOf(leaf.node),
        stage: top ? { id: top.id, title: top.title } : null,
        under: parent && parent !== top ? parent.title : null,
        waits: lane === 'later' ? waitOf(leaf.node, leaf.ancestors) : null,
      };
    };
  const order = {
    now: nowLeaves.map(entry('now')),
    next: nextLeaves.map(entry('next')),
    later: laterLeaves.map(entry('later')),
  };
  // A step waiting on one the plan numbers names it by that number, which
  // fits on a chip where a long title would not.
  const numberOf = new Map(planEntries(order).map((one) => [one.id, one.number]));
  for (const one of order.later) {
    const on = one.waits?.kind === 'step' ? one.node.waitingOn?.[0] : undefined;
    const n = on ? numberOf.get(on.id) : undefined;
    if (one.waits && n !== undefined) one.waits = { kind: 'step', label: `After step ${n}` };
    // Ready, but beyond Up next: it waits on its turn, the step numbered before it.
    if (!one.waits) one.waits = { kind: 'step', label: `After step ${one.number - 1}` };
  }
  return order;
}

/** Every entry in the order the Plan tab numbers them. */
export function planEntries(order: PlanOrder): PlanEntry[] {
  return [...order.now, ...order.next, ...order.later];
}

/** Which lane a step is in; null for a step the plan does not list (closed, proposed, a container). */
export function laneOf(order: PlanOrder, stepId: string): PlanLane | null {
  return planEntries(order).find((entry) => entry.id === stepId)?.lane ?? null;
}

/**
 * The steps that may show away from the goal's page, on the Goals home, the
 * Inbox and Todo (plan #2778.6): Now and Up next. Anything in Later is
 * further down the plan and stays on the goal.
 */
export function shownOutside(order: PlanOrder): Set<string> {
  return new Set([...order.now, ...order.next].map((entry) => entry.id));
}

/** The short line on whose a step is and when it is due: "Yours · by 18 Dec". */
export function whoseLine(entry: Pick<PlanEntry, 'whose' | 'node'>): string {
  const who = entry.whose === 'dash' ? 'Dash’s' : entry.whose === 'question' ? 'To answer' : 'Yours';
  return entry.node.dueOn ? `${who} · by ${formatDay(entry.node.dueOn)}` : who;
}

/**
 * Whether a step may show away from its goal's page (plan #2778.6): the one
 * test the Goals home, the Inbox, Todo and the morning brief share.
 */
export type ShowsOutside = (node: StepNode) => boolean;

/**
 * Which steps show on the Goals home, the Inbox and Todo. A step does when
 * the goal's Plan tab has it under Now or Up next; anything under Later stays
 * on the goal. Two kinds come through whatever lane they are in: a step with
 * a date inside seven days (due, overdue, or starting by then), and one you
 * put on Todo yourself. A step Dash sent to Todo is not the second kind, so
 * it follows the plan.
 *
 * `byGoal` is the trees as loadGoalMap builds them, with dependencies and
 * start dates marked (loadLiveTree does both).
 */
export function showsOutside(
  byGoal: ReadonlyMap<string, readonly StepNode[]>,
  today: string,
): ShowsOutside {
  const shown = new Set<string>();
  for (const steps of byGoal.values()) {
    for (const id of shownOutside(planOrder(steps, { today }))) shown.add(id);
  }
  const soonBy = addDays(today, SOON_DAYS);
  return (node) =>
    shown.has(node.id) ||
    (node.dueOn !== null && node.dueOn <= soonBy) ||
    (!!node.startsOn && node.startsOn <= soonBy) ||
    (node.onTodo && node.onTodoBy !== 'claude');
}
