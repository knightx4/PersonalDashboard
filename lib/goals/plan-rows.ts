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
 * - Goal steps have no number, so each is numbered in reading order from 1.
 *   The row, the dependency chips and the picker all show that number.
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

type Ref = { id: string; number: number; title: string };

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
  matches: true;
  rollup: PlanProgress;
  dependsOn: { dependencyId: string; item: Ref & { status: PlanStatus } }[];
  waitingOn: Ref[];
  blocks: Ref[];
  children: GoalRowNode[];
  /** The goal step this row draws. */
  step: StepNode;
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
  return {
    id: step.id,
    kind: step.kind === 'decision' ? 'decision' : 'build',
    status: review ? 'blocked' : planStatusOf(step.status),
    assignee: step.kind === 'mine' || step.kind === 'rhythm' ? 'me' : null,
    blockKind: review ? 'outside' : (step.blockKind ?? null),
    blockAsk: review ? REVIEW_ASK : (step.blockAsk ?? null),
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
 * The rows for a list of steps.
 *
 * `numbers` comes from `numberSteps` over everything on the page. A step
 * named in a dependency that is not on the page reads as #0, which only a
 * dependency across goals written by the routine can produce.
 */
export function goalRows(
  roots: readonly StepNode[],
  {
    numbers,
    threads,
    showAside,
  }: {
    numbers: ReadonlyMap<string, number>;
    threads: Readonly<Record<string, DevComment[]>>;
    showAside: boolean;
  },
): GoalRows {
  const all = flat(roots);
  const titles = new Map(all.map((step) => [step.id, step.title]));
  const ref = (step: { id: string; title: string }): Ref => ({
    id: step.id,
    number: numbers.get(step.id) ?? 0,
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
      outline: String(number),
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
): { id: string; number: number; title: string; parentId: string | null; depth: number; closed: boolean }[] {
  const out: ReturnType<typeof goalCatalog> = [];
  const walk = (list: readonly StepNode[], depth: number) => {
    for (const step of list) {
      out.push({
        id: step.id,
        number: numbers.get(step.id) ?? 0,
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
