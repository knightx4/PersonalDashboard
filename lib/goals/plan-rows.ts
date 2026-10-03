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
import { MOVE_WORD } from '@/lib/core/move';
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

/** What the health tooltip and the Needs line say about a Claude result waiting to be read. */
export const REVIEW_ASK = 'Read what Dash found and mark it read.';

/**
 * The health word for a Claude result waiting to be read. The plan's word for
 * it, Waiting on you, sat on a finished row beside Needs you and read as if
 * the step were stuck, when all it asks is to be read.
 */
export const REVIEW_WORD = 'To read';

/** What a ready step of yours waits on you for. */
export const YOURS_ASK = 'Yours to do. Do it and mark it done, or answer what is in the way.';

/**
 * The health word for a step that is yours and ready. It is on you in the
 * plan's terms, but "Waiting on you" read as if something were stuck, when
 * all it means is that the next move is yours. The goals home names the same
 * list Your move.
 */
export const YOURS_WORD = 'Your move';

/**
 * What an open step waiting on other steps needs, for its Needs line (plan
 * #1159): the steps it waits on, by number as the health tooltip names them,
 * and an answer where one of them is a question. Only its own waits: one it
 * shares with the step above it is said on that step's row.
 */
export function waitLine(
  waits: readonly Ref[],
  isQuestion: (id: string) => boolean,
): string | null {
  if (waits.length === 0) return null;
  const named = (ref: Ref) => `#${ref.outline ?? ref.number} ${ref.title}`;
  const list = (refs: readonly Ref[]) =>
    refs.length <= 2
      ? refs.map(named).join(' and ')
      : `${refs.slice(0, -1).map(named).join(', ')} and ${named(refs[refs.length - 1])}`;
  const steps = waits.filter((ref) => !isQuestion(ref.id));
  const questions = waits.filter((ref) => isQuestion(ref.id));
  return [
    steps.length > 0 ? `${list(steps)} done first` : null,
    questions.length > 0 ? `your answer to ${list(questions)}` : null,
  ]
    .filter(Boolean)
    .join(', and ');
}

/** The tooltip on a stage whose only open work is steps of yours. */
export const YOURS_BENEATH = 'A step beneath this one is yours to do.';

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
  /**
   * The row's Needs line: what the step waits on you for (note 5aa7216c), or
   * the steps and questions it waits on (plan #1159).
   */
  need: string | null;
  health: ReturnType<typeof healthWordsOf>;
  move: ReturnType<typeof moveWordsFor>;
  /** Who the step is on, for the row's second column: you, Dash, or both beneath it. */
  who: { word: string; tone: 'quiet' | 'accent'; title: string };
};

/**
 * Who a step is on (note 6d242e62): Dash for a Dash step, you for every other
 * kind -- yours, a question, a rhythm. A step with steps beneath it is on
 * whoever its open steps are on, or all of them once none is open.
 */
export function whoIsOn(step: StepNode): GoalRowNode['who'] {
  const on = new Set<'you' | 'dash'>();
  const walk = (node: StepNode, openOnly: boolean) => {
    if (node.children.length === 0) {
      if (!openOnly || node.status === 'open' || node.status === 'blocked') on.add(node.kind === 'claude' ? 'dash' : 'you');
      return;
    }
    for (const child of node.children) walk(child, openOnly);
  };
  walk(step, true);
  if (on.size === 0) walk(step, false);
  if (on.size === 2) return { word: 'You and Dash', tone: 'accent', title: 'Some steps beneath are yours and some are Dash’s.' };
  if (on.has('dash')) return { word: 'Dash', tone: 'accent', title: 'Dash does this step.' };
  return { word: 'You', tone: 'quiet', title: 'This step is yours to do.' };
}

/** The step as the plan's rules read it: enough of a `PlanNode` for them. */
type Shadow = {
  id: string;
  kind: PlanKind;
  status: PlanStatus;
  assignee: PlanAssignee | null;
  blockKind: 'steps' | 'outside' | null;
  blockAsk: string | null;
  /** A ready step of yours, read as blocked on you but worded Your move. */
  yours: boolean;
  /** A Claude result to read, read as blocked on you but worded To read. */
  review: boolean;
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
    yours,
    review,
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

/**
 * Whether a row reading blocked is blocked only by steps of yours that are
 * ready: the row itself, or, for a stage, every blocked row beneath it. A
 * real block or a Claude result to read anywhere in there keeps the plan's
 * "Waiting on you".
 */
function onlyYours(shadow: Shadow): boolean {
  if (shadow.status === 'blocked') return shadow.yours;
  const blocked = shadowFlat(shadow)
    .slice(1)
    .filter((row) => row.status === 'blocked');
  return blocked.length > 0 && blocked.every((row) => row.yours);
}

/**
 * The plan's health for a row, with a ready step of yours worded Your move
 * and a result to read worded To read.
 */
function goalHealth(shadow: Shadow, facts: HealthFacts) {
  const health = healthWordsOf(planHealthOf(asPlan(shadow)), facts);
  if (health.name !== 'blocked') return health;
  if (shadow.status === 'blocked' && shadow.review) {
    return { ...health, word: REVIEW_WORD, title: REVIEW_ASK };
  }
  if (!onlyYours(shadow)) return health;
  // A closed row keeps its tooltip, which names the open steps beneath it.
  const title = facts.closed ? health.title : shadow.yours ? YOURS_ASK : YOURS_BENEATH;
  return { ...health, word: YOURS_WORD, title };
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
  const questions = new Set(all.filter((step) => step.kind === 'decision').map((step) => step.id));
  const ready = readySteps(roots);
  const shadows = roots.map((root) => shadowOf(root, ready, ref));

  function toRow(
    step: StepNode,
    shadow: Shadow,
    inherited: ReadonlySet<string> = new Set(),
  ): GoalRowNode {
    const open = step.status === 'open' || step.status === 'blocked';
    const waits = open
      ? waitLine(
          shadow.waitingOn.filter((ref) => !inherited.has(ref.id)),
          (id) => questions.has(id),
        )
      : null;
    const onYou = shadow.status === 'blocked' && shadow.blockKind !== 'steps';
    const below = new Set(shadow.waitingOn.map((ref) => ref.id));
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
      children: pairs.map(([child, childShadow]) => toRow(child, childShadow, below)),
      step,
      need: (onYou ? shadow.blockAsk : null) ?? waits,
      health: goalHealth(shadow, facts),
      move: moveWordsFor(
        planMoveOf(asPlan(shadow)),
        planMoveOf(asPlan({ ...shadow, children: [] })),
      ),
      who: whoIsOn(step),
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
 * 9b6eba99): everything, what is still open, what waits on you, what is
 * ready for Dash to take, and what Dash found that is still to read (note
 * 704c8e3a).
 */
export const GOAL_VIEWS = ['all', 'open', 'you', 'ready', 'read'] as const;
export type GoalView = (typeof GOAL_VIEWS)[number];

export const GOAL_VIEW_LABEL: Record<GoalView, string> = {
  all: 'Everything',
  open: 'Open',
  you: MOVE_WORD.on_you,
  ready: 'Ready',
  read: REVIEW_WORD,
};

/**
 * The views drawn as chips on a goal's steps, in their order on the row, and
 * the rest in the menu at its end (plan #1157). The three #1156 chose; Ready
 * and To read stay a press away, since notes asked for both.
 */
export const GOAL_VIEW_CHIPS = ['open', 'you', 'all'] as const satisfies readonly GoalView[];
export const GOAL_VIEW_MENU = ['ready', 'read'] as const satisfies readonly GoalView[];

/** The view a page opens on: Open, which is what the goal page showed before it had chips. */
export const DEFAULT_GOAL_VIEW: GoalView = 'open';

export function isGoalView(value: string): value is GoalView {
  return (GOAL_VIEWS as readonly string[]).includes(value);
}

/** The view a `?view=` search parameter asks for, or Open when it names none. */
export function goalViewOf(param: string | string[] | undefined): GoalView {
  const requested = Array.isArray(param) ? param[0] : param;
  return requested && isGoalView(requested) ? requested : DEFAULT_GOAL_VIEW;
}

/** Where a view of the page at `path` lives. Open keeps the bare path, as /dev/plan's does. */
export function goalViewHref(path: string, view: GoalView): string {
  return view === DEFAULT_GOAL_VIEW ? path : `${path}?view=${view}`;
}

/** The healths the dev plan's "On you" view is made of (`needsThePerson` in lib/plan/tree.ts). */
const ON_YOU: ReadonlySet<string> = new Set(['unanswered', 'proposed', 'blocked', 'setup']);

function matchesGoalView(row: GoalRowNode, view: GoalView): boolean {
  const open = row.status !== 'done' && row.status !== 'dropped';
  switch (view) {
    case 'all':
      return true;
    case 'open':
      // A finished Dash step whose result you have not read is not finished
      // with, so it stays in Open with the rest of what is outstanding. Open
      // is the page's default, and a result hidden behind Everything would
      // go unread.
      return open || awaitsReview(row.step);
    case 'you':
      return open && ON_YOU.has(row.health.name);
    case 'ready':
      return open && row.health.name === 'ready';
    case 'read':
      // Usually done, since a Dash step closes once its result is stored.
      return awaitsReview(row.step);
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
