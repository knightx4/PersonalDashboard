/**
 * Blocked goal steps, and steps that wait on other steps (plan #981).
 *
 * A goal step can be blocked with a sentence saying what it needs, and can
 * wait on other steps, which clears itself when they close. The rules are the
 * dev plan's, read from `isStaleBlock` and `isReady` in lib/plan/tree.ts, with
 * one difference kept from the goals page: a sub-step holds its parent open
 * only while it is open or blocked, so a proposal beneath a step does not.
 *
 * The rows are goals.dependencies (supabase/migrations-goals/0016). Pure, so
 * the rules are tested without a database.
 */
import { DEFAULT_BLOCK_KIND, type PlanBlockKind, type PlanStatus } from '@/lib/plan/load';
import type { StepNode, StepStatus } from '@/lib/goals/steps';

/** The plan's two kinds of block: `steps` clears itself, `outside` waits on you. */
export type StepBlockKind = PlanBlockKind;

/** Enough of another step to name it. */
export type StepRef = { id: string; title: string; status: StepStatus };

/** One "cannot start until" edge, with the row it is stored as. */
export type StepLink = { dependencyId: string; item: StepRef };

/** A goals.dependencies row. */
export type DependencyRow = { id: string; itemId: string; dependsOnId: string };

/**
 * A goal step's status as the plan's word, for the shared tree components.
 * An open step has not been started in the plan's sense; goals have no
 * separate in-progress state.
 */
export function planStatusOf(status: StepStatus): PlanStatus {
  return status === 'open' ? 'not_started' : status;
}

/**
 * The plan's status word as a goal step's, for a status control shared with
 * the plan. `not_started` and `in_progress` are both open. `proposed` is not
 * something a status control sets on a goal step, so it is refused.
 */
export function stepStatusFromPlan(status: PlanStatus): Exclude<StepStatus, 'proposed'> | null {
  if (status === 'not_started' || status === 'in_progress') return 'open';
  if (status === 'proposed') return null;
  return status;
}

export function isClosedStatus(status: StepStatus): boolean {
  return status === 'done' || status === 'dropped';
}

function waitsOnItsSteps(node: { blockKind?: StepBlockKind | null }): boolean {
  return (node.blockKind ?? DEFAULT_BLOCK_KIND) === 'steps';
}

type BlockFacts = {
  status: StepStatus;
  blockKind?: StepBlockKind | null;
  dependsOn?: readonly StepLink[];
};

/**
 * Blocked on the steps it waits on, and every one of them has closed: the
 * block no longer holds, and the step reads as it would unblocked. As
 * `isStaleBlock` on the plan.
 */
export function isStaleStepBlock(node: BlockFacts): boolean {
  if (node.status !== 'blocked') return false;
  if (!waitsOnItsSteps(node)) return false;
  const dependsOn = node.dependsOn ?? [];
  return dependsOn.length > 0 && dependsOn.every((link) => isClosedStatus(link.item.status));
}

/** Blocked, and still blocked on something. As `isBlocked` on the plan. */
export function isStepBlocked(node: BlockFacts): boolean {
  return node.status === 'blocked' && !isStaleStepBlock(node);
}

/** Whether a sub-step keeps its parent from being ready. A put-aside question does not. */
function holdsParent(node: StepNode): boolean {
  const aside = node.kind === 'decision' && node.resolution === null && Boolean(node.dismissedAt);
  return (node.status === 'open' || node.status === 'blocked') && !aside;
}

/**
 * Whether a step could be picked up now. As `isReady` on the plan:
 *
 *  - It is open, or blocked on steps that have all closed.
 *  - Nothing it or a step above it waits on is still open.
 *  - Nothing beneath it is still open.
 *  - No step above it is proposed or dropped, or blocked on you.
 *  - Its start date, or one above it, has come (`waitsUntil`).
 */
export function isStepReady(
  node: StepNode,
  ancestors: readonly Pick<StepNode, 'status' | 'blockKind'>[],
): boolean {
  if (node.status !== 'open' && !isStaleStepBlock(node)) return false;
  if (node.waitsUntil) return false;
  if ((node.waitingOn ?? []).length > 0) return false;
  if (node.children.some(holdsParent)) return false;
  if (ancestors.some((a) => a.status === 'dropped' || a.status === 'proposed')) return false;
  if (ancestors.some((a) => a.status === 'blocked' && !waitsOnItsSteps(a))) return false;
  return true;
}

/**
 * Nothing open beneath it and nothing it waits on still open: what the home
 * and the morning run ask of a step before calling it next. A sub-step holds
 * it while open or blocked.
 */
export function waitsOnNothing(node: StepNode): boolean {
  if ((node.waitingOn ?? []).length > 0) return false;
  return !node.children.some((child) => child.status === 'open' || child.status === 'blocked');
}

const toRef = (node: StepNode): StepRef => ({ id: node.id, title: node.title, status: node.status });

/**
 * Hang the dependency rows on the built tree: each step's `dependsOn` and
 * `blocks`, and `waitingOn`, which is its own unfinished dependencies and
 * those of every step above it, as on the plan. `nodes` is every step shown;
 * an edge to a step out of view (archived, or under something archived) is
 * left out, as the plan leaves out an edge to a row it did not load.
 */
export function attachDependencies(
  byGoal: ReadonlyMap<string, StepNode[]>,
  nodes: ReadonlyMap<string, StepNode>,
  dependencies: readonly DependencyRow[],
): void {
  const dependsOn = new Map<string, StepLink[]>();
  const blocks = new Map<string, StepRef[]>();
  for (const dep of dependencies) {
    const item = nodes.get(dep.itemId);
    const target = nodes.get(dep.dependsOnId);
    if (!item || !target) continue;
    dependsOn.set(item.id, [
      ...(dependsOn.get(item.id) ?? []),
      { dependencyId: dep.id, item: toRef(target) },
    ]);
    blocks.set(target.id, [...(blocks.get(target.id) ?? []), toRef(item)]);
  }
  for (const node of nodes.values()) {
    node.dependsOn = dependsOn.get(node.id) ?? [];
    node.blocks = blocks.get(node.id) ?? [];
  }

  const walk = (list: StepNode[], inherited: StepRef[]) => {
    for (const node of list) {
      const seen = new Set(inherited.map((ref) => ref.id));
      const own = (dependsOn.get(node.id) ?? [])
        .map((link) => link.item)
        .filter((ref) => !isClosedStatus(ref.status) && !seen.has(ref.id));
      node.waitingOn = [...inherited, ...own];
      walk(node.children, node.waitingOn);
    }
  };
  for (const roots of byGoal.values()) walk(roots, []);
}

/**
 * Every step in a goal's tree with whether it is ready, keyed by id. Needs
 * `attachDependencies` first for the waits to count.
 */
export function readySteps(roots: readonly StepNode[]): Set<string> {
  const ready = new Set<string>();
  const walk = (list: readonly StepNode[], ancestors: StepNode[]) => {
    for (const node of list) {
      if (isStepReady(node, ancestors)) ready.add(node.id);
      walk(node.children, [...ancestors, node]);
    }
  };
  walk(roots, []);
  return ready;
}
