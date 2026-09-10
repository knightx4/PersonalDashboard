import { MODULES, type ModuleId } from '@/lib/modules';
import {
  isClosed,
  type PlanAssignee,
  type PlanData,
  type PlanItem,
  type PlanStatus,
} from './load';

/**
 * The plan, read.
 *
 * Rows come out of the database flat; this turns them into the thing the page
 * shows and the CLI works from — steps nested under steps, each one knowing
 * what it waits on, how far through its own steps it is, and whether it could
 * be picked up right now. Pure, so a page and a script agree on every one of
 * those answers, and so each rule below can be pinned by a test.
 */

export type PlanProgress = {
  done: number;
  inProgress: number;
  blocked: number;
  /** Steps that count toward the total: everything not dropped. */
  live: number;
  /** 0 to 1 over the live steps, or null when there are none to be through. */
  fraction: number | null;
};

/** Enough of another step to name it: in a chip, a picker, a brief. */
export type PlanRef = {
  id: string;
  number: number;
  title: string;
  status: PlanStatus;
  module: ModuleId | null;
};

/** One "cannot start until" edge, with the row it is stored as. */
export type PlanLink = {
  dependencyId: string;
  item: PlanRef;
};

export type PlanNode = PlanItem & {
  /** 0 at the top of a module's plan. */
  depth: number;
  children: PlanNode[];
  /** The steps this one is declared to wait on, done or not. */
  dependsOn: PlanLink[];
  /** The steps declared to wait on this one. */
  blocks: PlanRef[];
  /**
   * What actually holds it up: its own unfinished dependencies and those of
   * every step above it. A feature that waits on another waits with all of
   * its steps, whether or not each one says so.
   */
  waitingOn: PlanRef[];
  /** Over the leaf steps beneath it. `live` is 0 on a step with none. */
  rollup: PlanProgress;
  /** Could be started now. See `isReady` for the rule. */
  ready: boolean;
  /**
   * Under a view's filter: whether this step is one the view asked for, or
   * is shown only because something beneath it is.
   */
  matches: boolean;
};

/** One module's plan, and how far through it is. */
export type PlanSection = {
  module: ModuleId | null;
  label: string;
  nodes: PlanNode[];
  /** Over the leaf steps of the whole module, filtered or not. */
  progress: PlanProgress;
  /**
   * The states of those same steps, counted. Also over the whole module: a
   * view narrows what is listed, not what is true of the module.
   */
  tally: PlanTally;
};

export const PLAN_VIEWS = [
  'all',
  'open',
  'you',
  'ready',
  'proposed',
  'claude',
  'blocked',
  'fog',
] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export function isPlanView(value: string): value is PlanView {
  return (PLAN_VIEWS as readonly string[]).includes(value);
}

export const PLAN_VIEW_LABEL: Record<PlanView, string> = {
  all: 'Everything',
  open: 'Open',
  you: 'On you',
  ready: 'Ready',
  proposed: 'Proposed',
  claude: "Claude's",
  blocked: 'Waiting',
  fog: 'Not specified',
};

/** The numbers across the whole plan, for the strip at the top of the page. */
export type PlanSummary = {
  total: number;
  /**
   * Everything not finished: not done, not dropped.
   *
   * Proposals are in it. They used to be left out, on the grounds that nobody
   * had decided on them yet -- but that made the number disagree with the
   * Open view standing next to it, which has always listed them, and it made
   * "open" mean "open except for the part nobody has looked at", which is the
   * part most worth knowing about. A proposal is outstanding work in the only
   * sense the word is used here: it is not done, and somebody has to deal
   * with it.
   *
   * `planProgress` still leaves proposals out of its denominator, and that is
   * a different question -- how far through the decided work a module is,
   * which a proposal nobody has approved should not be holding back.
   */
  open: number;
  /** Open steps that cannot move until the person acts. See `needsThePerson`. */
  onYou: number;
  /** Written by a session, waiting on a person. */
  proposed: number;
  inProgress: number;
  /** Blocked by hand, or waiting on another step. */
  waiting: number;
  ready: number;
  done: number;
  /** Open steps handed to Claude. */
  claude: number;
  /** Steps carrying a "not yet specified" note, closed ones included. */
  fog: number;
};

/**
 * How far through a set of steps is.
 *
 * Dropped steps leave the denominator, because a step you decided against is
 * not work outstanding and counting it would hold a finished module at 90%
 * forever. Proposed steps leave it too: nobody has decided on them yet, and
 * a proposal that never gets approved should not have been holding a module
 * at 60% in the meantime. A set whose every step is one of those has no
 * fraction at all rather than a division by zero dressed up as 0%.
 *
 * In-progress counts as started and not as finished. Half-credit would make
 * the bar move when nothing shipped, which is the specific lie a progress bar
 * is worth having only if it does not tell.
 */
export function planProgress(items: readonly { status: PlanStatus }[]): PlanProgress {
  const live = items.filter((item) => item.status !== 'dropped' && item.status !== 'proposed');
  const done = live.filter((item) => item.status === 'done').length;
  const inProgress = live.filter((item) => item.status === 'in_progress').length;
  const blocked = live.filter((item) => item.status === 'blocked').length;

  return {
    done,
    inProgress,
    blocked,
    live: live.length,
    fraction: live.length === 0 ? null : done / live.length,
  };
}

export function toRef(item: PlanItem): PlanRef {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    status: item.status,
    module: item.module,
  };
}

/** Reading order among siblings: position, then age, then the number. */
function bySibling(a: PlanItem, b: PlanItem): number {
  return (
    a.position - b.position ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.number - b.number
  );
}

/**
 * A block that has outlived the thing it named.
 *
 * `blocked` means "needs an answer, or something outside the repo", and it is
 * deliberately a status that nothing clears on its own: no amount of other
 * work produces the credential. Waiting on another *step* is meant to be a row
 * in `plan_dependencies` instead, precisely because that does clear itself.
 *
 * A step marked `blocked` that also records dependencies has been given both,
 * and those rows are the only account the plan holds of what it was waiting
 * for. Once every one of them is closed, nothing recorded is holding the step
 * and the status column is simply out of date -- #20 sat blocked on #127 for a
 * day after #127 shipped, and the page went on saying "Waiting" with nothing
 * left to wait on, which is the bug this answers.
 *
 * A step blocked with no dependencies at all is untouched. That is the honest
 * use of the status, and nothing about it can be worked out from the tree.
 */
export function isStaleBlock(node: Pick<PlanNode, 'status' | 'dependsOn'>): boolean {
  return (
    node.status === 'blocked' &&
    node.dependsOn.length > 0 &&
    node.dependsOn.every((link) => isClosed(link.item.status))
  );
}

/**
 * Whether a step could be picked up now.
 *
 *  - It has not been started. A step underway is being worked, not waiting
 *    to be, and a blocked one has said why it cannot be -- unless every
 *    dependency it named has since closed, which is `isStaleBlock`.
 *  - Nothing it waits on, its own or inherited, is still open.
 *  - None of its own steps are still open. A feature with steps outstanding
 *    is worked through those steps; the feature itself is what you close when
 *    they are all done.
 *  - Nothing above it is blocked, dropped or still proposed. A step under a
 *    dropped feature is dropped in all but the column, one under a blocked
 *    feature waits with it, and one under a proposal has not been agreed to.
 */
export function isReady(
  node: Pick<PlanNode, 'status' | 'waitingOn' | 'children' | 'dependsOn'>,
  ancestors: readonly Pick<PlanItem, 'status'>[],
): boolean {
  if (node.status !== 'not_started' && !isStaleBlock(node)) return false;
  if (node.waitingOn.length > 0) return false;
  if (node.children.some((child) => !isClosed(child.status))) return false;
  if (ancestors.some((a) => ['blocked', 'dropped', 'proposed'].includes(a.status))) return false;
  return true;
}

/**
 * The flat rows as a tree, one section per module.
 *
 * Every module gets a section whether or not it has steps yet, because an
 * empty section is the invitation to write the plan for it — a module that
 * simply did not appear would read as one nobody is allowed to plan. The
 * app-wide section only once something is in it: unlike a module, it is not
 * a place anybody expects to find a plan waiting to be written.
 *
 * A step whose parent is missing — which the cascade should make impossible —
 * is shown at the top of its module rather than lost, because a plan that
 * quietly hides a row is worse than one with a row out of place.
 */
export function buildPlanTree(data: PlanData): PlanSection[] {
  const byId = new Map(data.items.map((item) => [item.id, item]));
  const childrenOf = new Map<string | null, PlanItem[]>();
  for (const item of data.items) {
    const parent = item.parentId && byId.has(item.parentId) ? item.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(item);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values()) list.sort(bySibling);

  const dependsOn = new Map<string, PlanLink[]>();
  const blocks = new Map<string, PlanRef[]>();
  for (const dep of data.dependencies) {
    const item = byId.get(dep.itemId);
    const target = byId.get(dep.dependsOnId);
    if (!item || !target) continue;
    dependsOn.set(item.id, [
      ...(dependsOn.get(item.id) ?? []),
      { dependencyId: dep.id, item: toRef(target) },
    ]);
    blocks.set(target.id, [...(blocks.get(target.id) ?? []), toRef(item)]);
  }

  function build(item: PlanItem, ancestors: PlanItem[], inherited: PlanRef[]): PlanNode {
    const own = (dependsOn.get(item.id) ?? [])
      .map((link) => link.item)
      .filter((ref) => !isClosed(ref.status));
    const seen = new Set(inherited.map((ref) => ref.id));
    const waitingOn = [...inherited, ...own.filter((ref) => !seen.has(ref.id))];

    const chain = [...ancestors, item];
    const children = (childrenOf.get(item.id) ?? []).map((child) =>
      build(child, chain, waitingOn),
    );

    const node: PlanNode = {
      ...item,
      depth: ancestors.length,
      children,
      dependsOn: (dependsOn.get(item.id) ?? []).sort((a, b) => a.item.number - b.item.number),
      blocks: (blocks.get(item.id) ?? []).sort((a, b) => a.number - b.number),
      waitingOn,
      rollup: planProgress(leavesOf(children)),
      ready: false,
      matches: true,
    };
    node.ready = isReady(node, ancestors);
    return node;
  }

  const roots = (childrenOf.get(null) ?? []).map((item) => build(item, [], []));

  const scopes: Array<ModuleId | null> = [...MODULES.map((module) => module.id), null];
  return scopes
    .map((scope) => {
      const nodes = roots.filter((node) => node.module === scope);
      return {
        module: scope,
        label: scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'The app as a whole',
        nodes,
        progress: planProgress(leavesOf(nodes)),
        tally: tallyHealth(nodes),
      };
    })
    .filter((section) => section.module !== null || section.nodes.length > 0);
}

/** The steps with no steps of their own, beneath these. */
export function leavesOf(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => (node.children.length === 0 ? [node] : leavesOf(node.children)));
}

/**
 * What state a step is actually in, as one word.
 *
 * This is not `node.status`. A question and a step share the status column but
 * do not mean the same things by it -- an unfinished decision is not "not
 * started", it is unanswered, and it closes on an answer rather than on a
 * commit. Nor is "ready" a status: it is worked out from what a step waits on
 * and what sits beneath it.
 *
 * It lives here rather than in the page because the page is no longer the only
 * thing asking. The dots beside a module heading count these, and a tally that
 * classified steps by its own slightly different rules would disagree with the
 * health column directly beneath it, on the same screen, about the same step.
 * The page keeps the wording, the icon and the tooltip; the rule is here.
 */
export const PLAN_HEALTHS = [
  'unanswered',
  'answered',
  'proposed',
  'in_progress',
  'blocked',
  'waiting',
  'ready',
  'not_started',
  'done',
  'dropped',
] as const;
export type PlanHealth = (typeof PLAN_HEALTHS)[number];

/**
 * Which open state speaks for a subtree, most pressing first.
 *
 * Only consulted for a closed row that still has open rows beneath it, and
 * only to pick which of them to report. The order is "how much does this stop
 * the work": a question nobody has answered, then a step that said what is
 * holding it up, then a proposal nobody has accepted, and so on down to a step
 * simply not reached yet.
 */
const OPEN_HEALTH_RANK: readonly PlanHealth[] = [
  'unanswered',
  'blocked',
  'proposed',
  'waiting',
  'in_progress',
  'ready',
  'not_started',
];

/** Every row beneath this one, at any depth. */
function descendantsOf(node: { children?: readonly PlanNode[] }): PlanNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendantsOf(child)]);
}

export function healthOf(
  node: Pick<PlanNode, 'kind' | 'status' | 'waitingOn' | 'ready' | 'dependsOn'> & {
    /**
     * Optional so the callers that classify one row on its own -- the tally,
     * which only ever sees leaves -- need not build a subtree to ask.
     */
    children?: readonly PlanNode[];
  },
): PlanHealth {
  // Closed on top of something open is not closed.
  //
  // A feature finished months ago can acquire a new row: #194, a question, was
  // added under #152 after it shipped, and the page went on saying "Done"
  // because that is what #152's own status column said. Health is meant to be
  // what the row means right now, so it reports the most pressing thing still
  // open beneath it instead -- and reports it deterministically, from the
  // subtree, rather than from when anybody last edited the parent.
  //
  // Dropped as well as done: a step decided against with live work under it is
  // the same wrong answer, and the open rows are the ones that need seeing.
  if (isClosed(node.status)) {
    const open = descendantsOf(node).filter((child) => !isClosed(child.status));
    if (open.length > 0) {
      const healths = new Set(open.map((child) => healthOf(child)));
      const worst = OPEN_HEALTH_RANK.find((health) => healths.has(health));
      if (worst) return worst;
    }
  }

  // A decision not yet settled is a question, whatever else is true of it.
  // "Ready" on a question would read as ready to be built, which is the one
  // thing it is not: nothing happens to it until somebody answers it.
  if (node.kind === 'decision' && !isClosed(node.status) && node.status !== 'blocked') {
    return 'unanswered';
  }
  if (node.kind === 'decision' && node.status === 'done') return 'answered';

  // A block whose every named dependency has closed is reported as the step it
  // now is, not as the block it used to be. See `isStaleBlock`: leaving it as
  // "Waiting" is the page claiming something is holding the step up when the
  // plan has no record of anything that is.
  if (isStaleBlock(node)) {
    return node.ready ? 'ready' : 'not_started';
  }

  switch (node.status) {
    case 'proposed':
      return 'proposed';
    case 'in_progress':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'dropped':
      return 'dropped';
    case 'not_started':
      if (node.waitingOn.length > 0) return 'waiting';
      return node.ready ? 'ready' : 'not_started';
  }
}

/** How many steps are in each state. Every health has an entry, most of them 0. */
export type PlanTally = Record<PlanHealth, number>;

/**
 * The states of a module's steps, counted.
 *
 * Over the leaves, which is the same set `planProgress` measures, and for the
 * same reason: a feature's state is mostly a summary of the steps under it, so
 * counting both says "twelve things" about a module that has seven. Questions
 * are leaves and so are counted -- an unanswered one is exactly the kind of
 * thing this is meant to surface without being opened.
 */
export function tallyHealth(nodes: readonly PlanNode[]): PlanTally {
  const tally = Object.fromEntries(PLAN_HEALTHS.map((health) => [health, 0])) as PlanTally;
  for (const leaf of leavesOf(nodes)) tally[healthOf(leaf)] += 1;
  return tally;
}

/** Every step in reading order: top to bottom, each step before its steps. */
export function flatten(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export function flattenSections(sections: readonly PlanSection[]): PlanNode[] {
  return sections.flatMap((section) => flatten(section.nodes));
}

export function findNode(sections: readonly PlanSection[], id: string): PlanNode | null {
  return flattenSections(sections).find((node) => node.id === id) ?? null;
}

/** The step and everything beneath it, by id. */
export function subtreeIds(node: PlanNode): Set<string> {
  return new Set(flatten([node]).map((item) => item.id));
}

/** The steps above one, top first. Empty at the top of a module. */
export function ancestorsOf(sections: readonly PlanSection[], id: string): PlanNode[] {
  const nodes = flattenSections(sections);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: PlanNode[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current) {
    const parent = byId.get(current);
    if (!parent || chain.includes(parent)) break;
    chain.unshift(parent);
    current = parent.parentId;
  }
  return chain;
}

/**
 * A step that cannot move until the person does something about it.
 *
 * Three kinds, and the test for each is "would anybody else be allowed to
 * settle this": an unanswered question is theirs by definition and a session
 * that answered one would be guessing with a paper trail; a proposal is a
 * session's suggestion and nothing happens to it until somebody says yes; a
 * blocked step is blocked with the exact thing it needs written on it, and
 * that thing is nearly always a person's to supply.
 *
 * A ready step assigned to them is deliberately not here. That is work they
 * could do, and mixing it in would make "everything waiting on you" a list you
 * cannot clear in an evening -- which is how a list like this stops being
 * opened.
 */
export function needsThePerson(
  node: Pick<PlanNode, 'kind' | 'status' | 'waitingOn' | 'ready' | 'dependsOn'>,
) {
  if (isClosed(node.status)) return false;
  const health = healthOf(node);
  return health === 'unanswered' || health === 'proposed' || health === 'blocked';
}

function matchesView(node: PlanNode, view: PlanView): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'open':
      return !isClosed(node.status);
    case 'you':
      return needsThePerson(node);
    case 'ready':
      return node.ready;
    case 'proposed':
      return node.status === 'proposed';
    case 'claude':
      return node.assignee === 'claude' && !isClosed(node.status);
    case 'blocked':
      return !isClosed(node.status) && (node.status === 'blocked' || node.waitingOn.length > 0);
    // Closed steps included. A finished feature still carrying fog is the
    // case worth seeing: the work stopped and the gap it admitted to did not
    // get filled. Nothing else on the page shows that.
    case 'fog':
      return node.fog !== null;
  }
}

function prune(nodes: readonly PlanNode[], view: PlanView): PlanNode[] {
  return nodes.flatMap((node) => {
    const children = prune(node.children, view);
    const matches = matchesView(node, view);
    if (!matches && children.length === 0) return [];
    return [{ ...node, children, matches }];
  });
}

/**
 * The plan narrowed to a view.
 *
 * A step that does not match stays if something beneath it does, dimmed, so
 * the ones that match are still seen in their place: "Ready" showing a bare
 * sub-step with no feature over it would answer "what" and not "of what".
 * The module's progress is left over the whole plan, because a filtered view
 * has not changed how far through anything is.
 *
 * "Open" keeps every module, empty or not, because it is the working view and
 * an empty module there is the invitation to plan it. The narrower views leave
 * out modules with nothing to show, so a narrowed page is a short one.
 */
export function applyView(sections: readonly PlanSection[], view: PlanView): PlanSection[] {
  if (view === 'all') return [...sections];
  return sections
    .map((section) => ({ ...section, nodes: prune(section.nodes, view) }))
    .filter((section) => view === 'open' || section.nodes.length > 0);
}

/**
 * What to pick up next, in order.
 *
 * Every ready step, most urgent first, and within a priority in reading order
 * — the modules in the order the switcher lists them, then top to bottom, so
 * two steps of equal weight are taken in the order the plan was written. The
 * sort is stable, which is what makes "in reading order" true.
 *
 * With one exception: a decision is never Claude's work, however it is
 * assigned. A decision is a question put to the person, and a session that
 * could pick one up would answer its own question — which is the whole thing
 * decisions exist to prevent. It stays ready, and it stays in the unfiltered
 * order, so it shows on the page and holds up everything waiting on it until
 * somebody settles it.
 */
export function workOrder(
  sections: readonly PlanSection[],
  options: { assignee?: PlanAssignee } = {},
): PlanNode[] {
  return flattenSections(sections)
    .filter((node) => node.ready)
    .filter((node) => (options.assignee ? node.assignee === options.assignee : true))
    .filter((node) => (options.assignee === 'claude' ? node.kind !== 'decision' : true))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Everything handed to Claude, in the order it should be worked.
 *
 * `workOrder` answers "what could be picked up right now", so it keeps only
 * ready steps. This answers a different question — "what has been handed over"
 * — and a step held up by another is still handed over: it is the second half
 * of a batch, not something to leave behind. The session works them in order
 * and the ones that wait say what they wait on.
 *
 * The two exclusions are the ones `workOrder` makes and for the same reasons. A
 * decision is a question put to the person, and a session that picked one up
 * would answer its own question. A proposal is not work yet — nobody has said
 * yes to it — so it is left for the person to approve, however it is assigned.
 */
export function handedToClaude(sections: readonly PlanSection[]): PlanNode[] {
  return flattenSections(sections)
    .filter((node) => node.assignee === 'claude')
    .filter((node) => !isClosed(node.status) && node.status !== 'proposed')
    .filter((node) => node.kind !== 'decision')
    .sort((a, b) => a.priority - b.priority);
}

export function summarize(sections: readonly PlanSection[]): PlanSummary {
  const nodes = flattenSections(sections);
  // Everything still outstanding, proposals included -- what the Open view
  // lists. The counts below it are about the decided work, so they keep the
  // narrower set: a proposal is not "ready", not "underway" and not Claude's.
  const outstanding = nodes.filter((node) => !isClosed(node.status));
  const open = outstanding.filter((node) => node.status !== 'proposed');
  return {
    total: nodes.length,
    open: outstanding.length,
    onYou: outstanding.filter((node) => needsThePerson(node)).length,
    proposed: nodes.filter((node) => node.status === 'proposed').length,
    inProgress: open.filter((node) => node.status === 'in_progress').length,
    waiting: open.filter((node) => node.status === 'blocked' || node.waitingOn.length > 0).length,
    ready: open.filter((node) => node.ready).length,
    done: nodes.filter((node) => node.status === 'done').length,
    claude: open.filter((node) => node.assignee === 'claude').length,
    fog: nodes.filter((node) => node.fog !== null).length,
  };
}
