/**
 * A goal's steps as rows of the dev plan's tree (plan #982).
 *
 * The goal page draws its steps with the plan's shared row
 * (components/plan-tree/tree-row.tsx), so each step is turned into the node
 * shape that row reads, and its health and move are worked out by the plan's
 * own rules in lib/plan/tree.ts rather than by a copy of them. A blocked step
 * and a waiting step therefore read on a goal exactly as they do on the plan.
 *
 * What a goal has and the plan does not is said in the plan's terms:
 *
 * - An open step is `not_started`; goals have no in-progress state.
 * - Your steps and rhythms are assigned to you, so their move is Yours. A
 *   Claude step is left unassigned, as a plan step the runner will take is.
 * - A Claude step whose result you have not read is on you: it is read as
 *   blocked on you, with the tooltip saying what to do. Only its health and
 *   move are read that way; its status stays what it is.
 * - So is a step of yours that is ready (note e501d1a5). Ready means ready for
 *   Dash, as it does on the plan; a step only you can do, with nothing in its
 *   way, is waiting on you to do it and say so. A step of yours that holds
 *   sub-steps is a stage, not a job, and is left to them.
 * - Goal steps have no number, so each is given two: a number in reading
 *   order from 1, which is the row's handle, and an outline, which is what
 *   the row, the dependency chips and the picker show. The outline reads as
 *   the plan's does: 12 for a top-level step, 12.1 and 12.2 under it, 12.1.1
 *   under those.
 *
 * Pure, so the mapping is tested without a page.
 */
import type { DevComment } from '@/lib/comments/load';
import { awaitsReview } from '@/lib/goals/daily';
import { planStatusOf, readySteps, type StepRef } from '@/lib/goals/dependencies';
import type { StepNode } from '@/lib/goals/steps';
import {
  healthOf as healthWordsOf,
  moveFor as moveWordsFor,
  type HealthFacts,
} from '@/lib/plan/health-words';
import type { PlanAssignee, PlanKind, PlanStatus } from '@/lib/plan/load';
import {
  healthOf as planHealthOf,
  leavesOf,
  moveOf as planMoveOf,
  planBands,
  planProgress,
  tallyHealth,
  type PlanBand,
  type PlanNode,
  type PlanProgress,
  type PlanTally,
} from '@/lib/plan/tree';

/** What the health tooltip says about a Claude result waiting to be read. */
export const REVIEW_ASK = 'Claude has finished this. Read what it produced and mark it read.';

/** What a ready step of yours waits on you for. */
export const YOURS_ASK = 'Yours to do. Do it and mark it done, or answer what is in the way.';

/** A step of yours with nothing in its way: on you, not ready for Dash. */
function yoursToDo(step: StepNode, ready: ReadonlySet<string>): boolean {
  return (
    step.kind === 'mine' &&
    step.status === 'open' &&
    step.children.length === 0 &&
    ready.has(step.id)
  );
}

type Ref = { id: string; number: number; outline?: string; title: string };

/** One goal step as the shared tree row reads it, with its step alongside. */
export type GoalRowNode = {
  id: string;
  number: number;
  outline: string;
  title: string;
  detail: string | null;
  resolution: string | null;
  status: PlanStatus;
  kind: PlanKind;
  dismissedAt: string | null;
  thread: DevComment[];
  module: null;
  acceptance: string | null;
  blockAsk: string | null;
  comment: null;
  fog: null;
  fogDismissedAt: null;
  /** Under a view: whether this row matched or is only here for what is beneath it. */
  matches: boolean;
  rollup: PlanProgress;
  dependsOn: { dependencyId: string; item: Ref & { status: PlanStatus } }[];
  waitingOn: Ref[];
  blocks: Ref[];
  children: GoalRowNode[];
  /** The goal step this row draws. */
  step: StepNode;
  /** What the step waits on you for, when it does: the row's Needs line (note 5aa7216c). */
  need: string | null;
  health: ReturnType<typeof healthWordsOf>;
  move: ReturnType<typeof moveWordsFor>;
};

/** The step as the plan's rules read it: enough of a `PlanNode` for them. */
type Shadow = {
  id: string;
  kind: PlanKind;
  status: PlanStatus;
  assignee: PlanAssignee | null;
  blockKind: 'steps' | 'outside' | null;
  blockAsk: string | null;
  dismissedAt: string | null;
  ready: boolean;
  dependsOn: { dependencyId: string; item: { id: string; status: PlanStatus } }[];
  waitingOn: Ref[];
  children: Shadow[];
};

const asPlan = (node: Shadow) => node as unknown as PlanNode;
const asPlanList = (nodes: readonly Shadow[]) => nodes as unknown as PlanNode[];

function flat(nodes: readonly StepNode[]): StepNode[] {
  return nodes.flatMap((node) => [node, ...flat(node.children)]);
}

function shadowOf(
  step: StepNode,
  ready: ReadonlySet<string>,
  number: (ref: StepRef) => Ref,
): Shadow {
  const review = awaitsReview(step);
  const yours = yoursToDo(step, ready);
  const onYou = review || yours;
  return {
    id: step.id,
    kind: step.kind === 'decision' ? 'decision' : 'build',
    status: onYou ? 'blocked' : planStatusOf(step.status),
    assignee: step.kind === 'mine' || step.kind === 'rhythm' ? 'me' : null,
    blockKind: onYou ? 'outside' : (step.blockKind ?? null),
    blockAsk: review ? REVIEW_ASK : yours ? YOURS_ASK : (step.blockAsk ?? null),
    dismissedAt: step.dismissedAt ?? null,
    ready: ready.has(step.id),
    dependsOn: (step.dependsOn ?? []).map((link) => ({
      dependencyId: link.dependencyId,
      item: { id: link.item.id, status: planStatusOf(link.item.status) },
    })),
    waitingOn: (step.waitingOn ?? []).map(number),
    children: step.children.map((child) => shadowOf(child, ready, number)),
  };
}

function shadowFlat(node: Shadow): Shadow[] {
  return [node, ...node.children.flatMap(shadowFlat)];
}

/** A question put aside with Not now. Left out of the rows unless they are asked for. */
function isAside(step: StepNode): boolean {
  return step.kind === 'decision' && Boolean(step.dismissedAt);
}

export type GoalRows = {
  rows: GoalRowNode[];
  /** For the strip above the rows: the same counts and bar a plan module has. */
  tally: PlanTally;
  bands: PlanBand[];
  progress: PlanProgress;
};

/**
 * Number every step in these trees in reading order, from 1. Given all the
 * trees a page shows at once, so no two rows share a number.
 */
export function numberSteps(trees: readonly (readonly StepNode[])[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const step of trees.flatMap((roots) => flat(roots))) {
    if (!numbers.has(step.id)) numbers.set(step.id, numbers.size + 1);
  }
  return numbers;
}

/**
 * Where every step in these trees sits, as the row labels it: the top-level
 * steps count from 1 across all the trees, and each step's sub-steps count
 * from 1 under it, so the second sub-step of the twelfth step is 12.2 and
 * its first sub-step 12.2.1. Given all the trees a page shows at once, so no
 * two rows share an outline.
 */
export function outlineSteps(trees: readonly (readonly StepNode[])[]): Map<string, string> {
  const outlines = new Map<string, string>();
  const walk = (list: readonly StepNode[], prefix: string) =>
    list.forEach((step, index) => {
      if (outlines.has(step.id)) return;
      const outline = `${prefix}${index + 1}`;
      outlines.set(step.id, outline);
      walk(step.children, `${outline}.`);
    });
  let top = 0;
  for (const roots of trees) {
    for (const root of roots) {
      if (outlines.has(root.id)) continue;
      top += 1;
      outlines.set(root.id, String(top));
      walk(root.children, `${top}.`);
    }
  }
  return outlines;
}

/**
 * The rows for a list of steps.
 *
 * `numbers` comes from `numberSteps` and `outlines` from `outlineSteps`, both
 * over everything on the page. A step named in a dependency that is not on
 * the page reads as #0 with no outline, which only a dependency across goals
 * written by the routine can produce.
 */
export function goalRows(
  roots: readonly StepNode[],
  {
    numbers,
    outlines = new Map(),
    threads,
    showAside,
  }: {
    numbers: ReadonlyMap<string, number>;
    outlines?: ReadonlyMap<string, string>;
    threads: Readonly<Record<string, DevComment[]>>;
    showAside: boolean;
  },
): GoalRows {
  const all = flat(roots);
  const titles = new Map(all.map((step) => [step.id, step.title]));
  const ref = (step: { id: string; title: string }): Ref => ({
    id: step.id,
    number: numbers.get(step.id) ?? 0,
    outline: outlines.get(step.id),
    title: titles.get(step.id) ?? step.title,
  });
  const ready = readySteps(roots);
  const shadows = roots.map((root) => shadowOf(root, ready, ref));

  function toRow(step: StepNode, shadow: Shadow): GoalRowNode {
    const number = numbers.get(step.id) ?? 0;
    const pairs = step.children
      .map((child, index) => [child, shadow.children[index]] as const)
      .filter(([child]) => showAside || !isAside(child));
    const beneath = shadowFlat(shadow).slice(1);
    const facts: HealthFacts = {
      closed: shadow.status === 'done' || shadow.status === 'dropped',
      openBeneath: beneath
        .filter((row) => row.status !== 'done' && row.status !== 'dropped')
        .map((row) => ref({ id: row.id, title: titles.get(row.id) ?? '' })),
      resolution: step.resolution,
      blockAsk: shadow.blockAsk,
      comment: null,
      waitingOn: shadow.waitingOn,
    };
    return {
      id: step.id,
      number,
      outline: outlines.get(step.id) ?? String(number),
      title: step.title,
      detail: step.detail,
      resolution: step.resolution,
      status: planStatusOf(step.status),
      kind: step.kind === 'decision' ? 'decision' : 'build',
      dismissedAt: step.dismissedAt ?? null,
      thread: threads[step.id] ?? [],
      module: null,
      acceptance: step.acceptance,
      blockAsk: step.status === 'blocked' ? (step.blockAsk ?? null) : null,
      comment: null,
      fog: null,
      fogDismissedAt: null,
      matches: true,
      rollup: planProgress(leavesOf(asPlanList(shadow.children))),
      dependsOn: (step.dependsOn ?? []).map((link) => ({
        dependencyId: link.dependencyId,
        item: { ...ref(link.item), status: planStatusOf(link.item.status) },
      })),
      waitingOn: shadow.waitingOn,
      blocks: (step.blocks ?? []).map(ref),
      children: pairs.map(([child, childShadow]) => toRow(child, childShadow)),
      step,
      need: shadow.status === 'blocked' && shadow.blockKind !== 'steps' ? shadow.blockAsk : null,
      health: healthWordsOf(planHealthOf(asPlan(shadow)), facts),
      move: moveWordsFor(
        planMoveOf(asPlan(shadow)),
        planMoveOf(asPlan({ ...shadow, children: [] })),
      ),
    };
  }

  const rows = roots
    .map((root, index) => [root, shadows[index]] as const)
    .filter(([root]) => showAside || !isAside(root))
    .map(([root, shadow]) => toRow(root, shadow));

  const plan = asPlanList(shadows);
  return {
    rows,
    tally: tallyHealth(plan),
    bands: planBands(plan),
    progress: planProgress(leavesOf(plan)),
  };
}

/** Every step on the page, for the dependency picker. */
export function goalCatalog(
  roots: readonly StepNode[],
  numbers: ReadonlyMap<string, number>,
  outlines: ReadonlyMap<string, string> = new Map(),
): {
  id: string;
  number: number;
  outline?: string;
  title: string;
  parentId: string | null;
  depth: number;
  closed: boolean;
}[] {
  const out: ReturnType<typeof goalCatalog> = [];
  const walk = (list: readonly StepNode[], depth: number) => {
    for (const step of list) {
      out.push({
        id: step.id,
        number: numbers.get(step.id) ?? 0,
        outline: outlines.get(step.id),
        title: step.title,
        parentId: step.parentId,
        depth,
        closed: step.status === 'done' || step.status === 'dropped',
      });
      walk(step.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/**
 * The views over a goal's steps, as the dev plan has over the plan (note
 * 9b6eba99): everything, what is still open, what waits on you, and what is
 * ready for Dash to take.
 */
export const GOAL_VIEWS = ['all', 'open', 'you', 'ready'] as const;
export type GoalView = (typeof GOAL_VIEWS)[number];

export const GOAL_VIEW_LABEL: Record<GoalView, string> = {
  all: 'Everything',
  open: 'Open',
  you: 'On you',
  ready: 'Ready',
};

/** The healths the dev plan's "On you" view is made of (`needsThePerson` in lib/plan/tree.ts). */
const ON_YOU: ReadonlySet<string> = new Set(['unanswered', 'proposed', 'blocked', 'setup']);

function matchesGoalView(row: GoalRowNode, view: GoalView): boolean {
  const open = row.status !== 'done' && row.status !== 'dropped';
  switch (view) {
    case 'all':
      return true;
    case 'open':
      return open;
    case 'you':
      return open && ON_YOU.has(row.health.name);
    case 'ready':
      return open && row.health.name === 'ready';
  }
}

/**
 * The rows narrowed to a view. A row that does not match stays, dimmed, when
 * something beneath it does, so a matching sub-step is still seen in its
 * place -- the same rule as the plan's views.
 */
export function viewGoalRows(rows: readonly GoalRowNode[], view: GoalView): GoalRowNode[] {
  if (view === 'all') return [...rows];
  return rows.flatMap((row) => {
    const children = viewGoalRows(row.children, view);
    const matches = matchesGoalView(row, view);
    if (!matches && children.length === 0) return [];
    return [{ ...row, children, matches }];
  });
}

/** How many rows, at any depth, a view matches. */
export function countGoalView(rows: readonly GoalRowNode[], view: GoalView): number {
  return rows.reduce(
    (sum, row) => sum + (matchesGoalView(row, view) ? 1 : 0) + countGoalView(row.children, view),
    0,
  );
}
