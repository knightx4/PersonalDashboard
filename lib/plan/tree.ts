import { MODULES, type ModuleId } from '@/lib/modules';
import {
  hasLiveFog,
  isClosed,
  isDismissed,
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
  /** Those same states again, as the bands of the progress bar. */
  bands: PlanBand[];
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
  'dismissed',
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
  claude: "Dash's",
  blocked: 'Waiting',
  fog: 'Not specified',
  dismissed: 'Dismissed',
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
  /** Rows put aside, and rows whose fog was. The only count they appear in. */
  dismissed: number;
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
export function planProgress(
  items: readonly {
    status: PlanStatus;
    dependsOn?: readonly PlanLink[];
    dismissedAt?: string | null;
  }[],
): PlanProgress {
  // A dismissed question is out of the denominator with the proposals and the
  // dropped steps. It is not work anybody is doing, and counted it would hold
  // a feature below 100% for as long as it stayed put aside.
  const live = items.filter(
    (item) =>
      item.status !== 'dropped' &&
      item.status !== 'proposed' &&
      !isDismissed({ dismissedAt: item.dismissedAt ?? null }),
  );
  const done = live.filter((item) => item.status === 'done').length;
  const inProgress = live.filter((item) => item.status === 'in_progress').length;
  const blocked = live.filter((item) => isBlocked(item)).length;

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
export function isStaleBlock(node: {
  status: PlanStatus;
  dependsOn?: readonly PlanLink[];
}): boolean {
  const dependsOn = node.dependsOn ?? [];
  return (
    node.status === 'blocked' &&
    dependsOn.length > 0 &&
    dependsOn.every((link) => isClosed(link.item.status))
  );
}

/**
 * Blocked, and still blocked on something.
 *
 * The status column on its own is not the answer to "is this held up", and
 * every count and filter that asked it that way disagreed with the row it was
 * counting: #20 sat with both of its dependencies closed, so its badge read
 * "Ready" while the summary said "1 waiting" and the Waiting view listed it
 * with nothing left to show as the thing it waits for. One of those was wrong
 * and it was the count -- `isStaleBlock` had been taught to `healthOf` and
 * `isReady` and to nothing else.
 *
 * So this is the question to ask anywhere the page speaks about blocked work.
 * `status === 'blocked'` is still the right test for the status *column* --
 * the dropdown says Blocked because that is what the row says, and it is the
 * person's to change.
 */
export function isBlocked(node: { status: PlanStatus; dependsOn?: readonly PlanLink[] }): boolean {
  return node.status === 'blocked' && !isStaleBlock(node);
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
  // A dismissed step is not one of the steps outstanding. Left in, a question
  // put aside would hold its feature open for good, which is the opposite of
  // what dismissing it was for.
  if (node.children.some((child) => !isClosed(child.status) && !isDismissed(child))) return false;
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
        bands: planBands(nodes),
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
 * thing asking. The counts beside a module heading count these, and a tally
 * that classified steps by its own slightly different rules would disagree
 * with the health column directly beneath it, on the same screen, about the
 * same step. The page keeps the wording and the tooltip, lib/status-glyphs.ts
 * keeps the shape; the rule is here.
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
    const open = descendantsOf(node).filter(
      (child) => !isClosed(child.status) && !isDismissed(child),
    );
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
 * thing this is meant to surface without being opened. A dismissed one is not:
 * the count beside a module heading is one of the places it stopped being
 * asked about.
 */
export function tallyHealth(nodes: readonly PlanNode[]): PlanTally {
  const tally = Object.fromEntries(PLAN_HEALTHS.map((health) => [health, 0])) as PlanTally;
  for (const leaf of leavesOf(nodes)) {
    if (isDismissed(leaf)) continue;
    tally[healthOf(leaf)] += 1;
  }
  return tally;
}

/**
 * The order the progress bar draws its states in, left to right.
 *
 * Finished at the left and untouched at the right, with everything else
 * between them in the order work actually moves: done, an answered question,
 * underway, ready to pick up, then the two stuck states, then not reached.
 * A bar whose bands moved around as the counts changed would be a different
 * picture every week, so the order is fixed here and never sorted by size.
 *
 * `proposed` and `dropped` are absent because they are not in the denominator
 * -- see `planProgress`. Drawing them would put the bar and the "8 of 12"
 * beside it into disagreement about how many steps a module has.
 */
export const PLAN_BAND_ORDER: readonly PlanHealth[] = [
  'done',
  'answered',
  'in_progress',
  'ready',
  'blocked',
  'unanswered',
  'waiting',
  'not_started',
];

/** One band of the progress bar: a state, and how much of the bar it owns. */
export type PlanBand = { health: PlanHealth; count: number };

/**
 * A module's live steps by state, as the bands of one bar.
 *
 * The bar used to be a single green length: the done fraction, and everything
 * else undifferentiated track. That is one number, and it hid the shape of
 * what was left -- eleven steps nobody has started and eleven questions
 * waiting on an answer drew exactly the same bar and are not remotely the same
 * module. The tally beside it already said which; this makes the bar say it
 * too, in the tones the health column under it is already using.
 *
 * Over the same live leaves `planProgress` measures, and classified by the
 * same `healthOf` the tally and the health column use, so the bands sum to
 * `progress.live` and no two things on this row can disagree. Empty states are
 * dropped: a band of zero is nothing to draw and nothing to say (law 1).
 */
export function planBands(nodes: readonly PlanNode[]): PlanBand[] {
  const live = leavesOf(nodes).filter(
    (leaf) => leaf.status !== 'dropped' && leaf.status !== 'proposed',
  );

  const counts = new Map<PlanHealth, number>();
  for (const leaf of live) {
    const health = healthOf(leaf);
    counts.set(health, (counts.get(health) ?? 0) + 1);
  }

  return PLAN_BAND_ORDER.filter((health) => (counts.get(health) ?? 0) > 0).map((health) => ({
    health,
    count: counts.get(health) as number,
  }));
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
  node: Pick<PlanNode, 'kind' | 'status' | 'waitingOn' | 'ready' | 'dependsOn'> & {
    dismissedAt?: string | null;
  },
) {
  if (isClosed(node.status)) return false;
  // Dismissing is how a row stops being on you without being settled.
  if (isDismissed({ dismissedAt: node.dismissedAt ?? null })) return false;
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
      return (
        node.assignee === 'claude' && !isClosed(node.status) && !isWaitingOnThePerson(node)
      );
    case 'blocked':
      return !isClosed(node.status) && (isBlocked(node) || node.waitingOn.length > 0);
    // Closed steps included. A finished feature still carrying fog is the
    // case worth seeing: the work stopped and the gap it admitted to did not
    // get filled. Nothing else on the page shows that. A patch you have put
    // aside is not in it — that is what putting it aside meant.
    case 'fog':
      return hasLiveFog(node);
    // The one view that asks for what everything else hides: a question you
    // are not answering now, and a row whose fog you have put aside. Both,
    // because a feature can be here for its fog while it is otherwise live.
    case 'dismissed':
      return isDismissed(node) || node.fogDismissedAt !== null;
  }
}

/**
 * A dismissed row leaves every view but the one that looks for it, and takes
 * its own steps with it. Dropping it inside `matchesView` would not be enough:
 * a parent stays when a child matches, so a dismissed question would come back
 * the moment anything under it did.
 */
function prune(nodes: readonly PlanNode[], view: PlanView): PlanNode[] {
  return nodes.flatMap((node) => {
    if (isDismissed(node) && view !== 'dismissed') return [];
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
 * "Everything" is the only view that keeps a module with nothing in it. That
 * empty section is the invitation to plan the module, and a module that simply
 * did not appear anywhere would read as one nobody is allowed to plan. Every
 * other view drops it, "Open" included: four of the seven modules have nothing
 * open, and four headings you scroll past to reach the work are four too many
 * when the invitation is one click away.
 *
 * "Everything" goes through the same pruning rather than past it, because
 * dismissed rows are hidden from every view and it is a view.
 */
export function applyView(sections: readonly PlanSection[], view: PlanView): PlanSection[] {
  return sections
    .map((section) => ({ ...section, nodes: prune(section.nodes, view) }))
    .filter((section) => view === 'all' || section.nodes.length > 0);
}

/**
 * A feature nobody is coming back to: closed itself, with nothing open under
 * it. About 101 of the plan's 110 top-level features are in this state, and
 * they are consulted rather than read -- "did I already plan that" -- so on
 * "Everything" they are gathered into one fold instead of running down the
 * page between the nine features that still have work in them.
 *
 * Dropped counts as closed here. A feature decided against is as finished as
 * one that shipped, and the row says which it was.
 */
export function isFinishedFeature(node: PlanNode): boolean {
  return isClosed(node.status) && !flatten(node.children).some((child) => !isClosed(child.status));
}

/** When a feature stopped being worked, for ordering the archive. */
function finishedAt(node: PlanNode): string {
  return node.completedAt ?? node.createdAt;
}

/**
 * "Everything", with the finished features lifted out of the modules.
 *
 * They come back as one list across every module, newest first, because that
 * is the order you look for them in: the thing you finished last week is the
 * thing you are trying to remember. Each module keeps its progress and its
 * tally, which are over the whole module either way -- lifting the rows out
 * changes where they are drawn, not what is true of the module.
 *
 * Only worth calling on "Everything". Every other view has already dropped a
 * finished feature in `prune`, so there is nothing to lift out of it.
 */
export function splitFinished(sections: readonly PlanSection[]): {
  sections: PlanSection[];
  finished: PlanNode[];
} {
  const finished: PlanNode[] = [];
  const kept = sections.map((section) => {
    const nodes = section.nodes.filter((node) => {
      if (!isFinishedFeature(node)) return true;
      finished.push(node);
      return false;
    });
    return { ...section, nodes };
  });
  finished.sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  return { sections: kept, finished };
}

/**
 * Whether a step answers a search.
 *
 * The number, the title and the detail, because those are the three ways
 * somebody refers to a step they are trying to find again: "#342", "the shelf
 * picker", or a phrase they remember writing into the detail. The number
 * matches with or without its hash, so typing `342` and `#342` both work.
 *
 * Every term has to match, and each may match a different field — "342 shelf"
 * finds the step only if it is both. Case and surrounding space are ignored.
 */
function matchesQuery(node: PlanNode, terms: readonly string[]): boolean {
  const haystack = [`#${node.number}`, node.title, node.detail ?? '']
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** A query split into the terms every step has to carry. Empty when blank. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^#/, ''))
    .filter(Boolean);
}

/** A whole subtree kept for context, so nothing under a hit reads as a hit. */
function asContext(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.map((node) => ({
    ...node,
    children: asContext(node.children),
    matches: false,
  }));
}

function pruneToQuery(nodes: readonly PlanNode[], terms: readonly string[]): PlanNode[] {
  return nodes.flatMap((node): PlanNode[] => {
    const matches = matchesQuery(node, terms);
    // A hit keeps the steps beneath it, the way opening the row would show
    // them: finding a feature and being handed it with its steps stripped out
    // is finding the wrong thing. They are context, not hits, so they are
    // marked as such -- otherwise the count would call a one-hit search seven.
    if (matches) return [{ ...node, children: asContext(node.children), matches: true }];

    const children = pruneToQuery(node.children, terms);
    if (children.length === 0) return [];
    return [{ ...node, children, matches: false }];
  });
}

/**
 * The plan narrowed to a search.
 *
 * The same shape as a view, and deliberately so: a step that does not match
 * stays if something beneath it does, dimmed, so a hit is still read in its
 * place rather than as a bare sub-step with no feature over it. `matches` is
 * the flag the row already dims on, so search needs nothing new to render.
 *
 * A blank query is not a search and gives the sections back untouched, so the
 * caller does not have to decide whether to call this.
 *
 * Modules with no hits are dropped, every view included -- unlike "Open",
 * which keeps an empty module because an empty module is an invitation to plan
 * it. Under a search it is only noise between results.
 */
export function searchSections(
  sections: readonly PlanSection[],
  query: string,
): PlanSection[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return sections.map((section) => ({ ...section }));

  return sections
    .map((section) => ({ ...section, nodes: pruneToQuery(section.nodes, terms) }))
    .filter((section) => section.nodes.length > 0);
}

/**
 * A search over steps that are not in a module section: the archive of
 * finished features on "Everything". The same rules as `searchSections`, so a
 * feature folded away is still found by number, title or detail.
 */
export function searchNodes(nodes: readonly PlanNode[], query: string): PlanNode[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...nodes];
  return pruneToQuery(nodes, terms);
}

/** How many steps a search actually found, as opposed to kept for context. */
export function countMatches(sections: readonly PlanSection[]): number {
  return flattenSections(sections).filter((node) => node.matches).length;
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
    .filter((node) => !isDismissed(node))
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
    .filter((node) => !isDismissed(node))
    .filter((node) => !isClosed(node.status) && node.status !== 'proposed')
    .filter((node) => !isWaitingOnThePerson(node))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * A step that is waiting on the person, and so cannot be Claude's.
 *
 * Two states, and both mean the same thing: nothing a session does moves this.
 * An unanswered decision is a question put to the person, and a session that
 * picked one up would be answering its own question. A blocked step said what
 * it needs and it is outside the repo -- a credential, an account, a choice --
 * so handing it over sends a session to sit in front of the same wall.
 *
 * This is why a hand-over skips them and why they are unhanded when they get
 * there: a queue that lists work nobody can do is a queue that stops being
 * read. It supersedes the old "not a decision" exclusion, which caught half of
 * it -- a blocked step went on sitting in Claude's list with a reason written
 * on it saying why it could not be worked.
 *
 * Not the same set as `needsThePerson`, which also counts a proposal. A
 * proposal is a suggestion nobody has agreed to rather than work stuck on
 * something, and it is excluded from a hand-over on its own grounds.
 */
export function isWaitingOnThePerson(
  node: Pick<PlanNode, 'kind' | 'status'> & { dependsOn?: readonly PlanLink[] },
): boolean {
  if (isBlocked(node)) return true;
  return node.kind === 'decision' && !isClosed(node.status);
}

/**
 * The feature a step belongs to: the highest step above it, or itself.
 *
 * The whole tree it sits in, rather than the nearest ancestor that says what
 * finishing means -- lib/plan/brief.ts wants that narrower one for a
 * destination, and this one is for the rules that hold over a batch: one
 * session per feature, and a re-shape that re-reads everything under the top
 * of the tree.
 */
export function topFeatureOf(sections: readonly PlanSection[], node: PlanNode): PlanNode {
  const ancestors = ancestorsOf(sections, node.id);
  return ancestors[0] ?? node;
}

export function summarize(sections: readonly PlanSection[]): PlanSummary {
  const all = flattenSections(sections);
  // Every count on the strip is over the rows still being asked about. A
  // dismissed one is in exactly one of them, the one that says how many there
  // are to find.
  const nodes = all.filter((node) => !isDismissed(node));
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
    waiting: open.filter((node) => isBlocked(node) || node.waitingOn.length > 0).length,
    ready: open.filter((node) => node.ready).length,
    done: nodes.filter((node) => node.status === 'done').length,
    claude: open.filter((node) => node.assignee === 'claude' && !isWaitingOnThePerson(node))
      .length,
    fog: nodes.filter((node) => hasLiveFog(node)).length,
    dismissed: all.filter((node) => isDismissed(node) || node.fogDismissedAt !== null).length,
  };
}
