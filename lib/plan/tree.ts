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
};

export const PLAN_VIEWS = ['all', 'open', 'ready', 'claude', 'blocked'] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export function isPlanView(value: string): value is PlanView {
  return (PLAN_VIEWS as readonly string[]).includes(value);
}

export const PLAN_VIEW_LABEL: Record<PlanView, string> = {
  all: 'Everything',
  open: 'Open',
  ready: 'Ready',
  claude: "Claude's",
  blocked: 'Waiting',
};

/** The numbers across the whole plan, for the strip at the top of the page. */
export type PlanSummary = {
  total: number;
  /** Not done and not dropped. */
  open: number;
  inProgress: number;
  /** Blocked by hand, or waiting on another step. */
  waiting: number;
  ready: number;
  done: number;
  /** Open steps handed to Claude. */
  claude: number;
};

/**
 * How far through a set of steps is.
 *
 * Dropped steps leave the denominator, because a step you decided against is
 * not work outstanding and counting it would hold a finished module at 90%
 * forever. A set whose every step is dropped has no fraction at all rather
 * than a division by zero dressed up as 0%.
 *
 * In-progress counts as started and not as finished. Half-credit would make
 * the bar move when nothing shipped, which is the specific lie a progress bar
 * is worth having only if it does not tell.
 */
export function planProgress(items: readonly { status: PlanStatus }[]): PlanProgress {
  const live = items.filter((item) => item.status !== 'dropped');
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
 * Whether a step could be picked up now.
 *
 *  - It has not been started. A step underway is being worked, not waiting
 *    to be, and a blocked one has said why it cannot be.
 *  - Nothing it waits on, its own or inherited, is still open.
 *  - None of its own steps are still open. A feature with steps outstanding
 *    is worked through those steps; the feature itself is what you close when
 *    they are all done.
 *  - Nothing above it is blocked or dropped. A step under a dropped feature
 *    is dropped in all but the column, and one under a blocked feature waits
 *    with it.
 */
export function isReady(
  node: Pick<PlanNode, 'status' | 'waitingOn' | 'children'>,
  ancestors: readonly Pick<PlanItem, 'status'>[],
): boolean {
  if (node.status !== 'not_started') return false;
  if (node.waitingOn.length > 0) return false;
  if (node.children.some((child) => !isClosed(child.status))) return false;
  if (ancestors.some((a) => a.status === 'blocked' || a.status === 'dropped')) return false;
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
      };
    })
    .filter((section) => section.module !== null || section.nodes.length > 0);
}

/** The steps with no steps of their own, beneath these. */
export function leavesOf(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => (node.children.length === 0 ? [node] : leavesOf(node.children)));
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

function matchesView(node: PlanNode, view: PlanView): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'open':
      return !isClosed(node.status);
    case 'ready':
      return node.ready;
    case 'claude':
      return node.assignee === 'claude' && !isClosed(node.status);
    case 'blocked':
      return !isClosed(node.status) && (node.status === 'blocked' || node.waitingOn.length > 0);
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
 */
export function workOrder(
  sections: readonly PlanSection[],
  options: { assignee?: PlanAssignee } = {},
): PlanNode[] {
  return flattenSections(sections)
    .filter((node) => node.ready)
    .filter((node) => (options.assignee ? node.assignee === options.assignee : true))
    .sort((a, b) => a.priority - b.priority);
}

export function summarize(sections: readonly PlanSection[]): PlanSummary {
  const nodes = flattenSections(sections);
  const open = nodes.filter((node) => !isClosed(node.status));
  return {
    total: nodes.length,
    open: open.length,
    inProgress: open.filter((node) => node.status === 'in_progress').length,
    waiting: open.filter((node) => node.status === 'blocked' || node.waitingOn.length > 0).length,
    ready: open.filter((node) => node.ready).length,
    done: nodes.filter((node) => node.status === 'done').length,
    claude: open.filter((node) => node.assignee === 'claude').length,
  };
}
