import { DEFAULT_BLOCK_KIND, isClosed, isDismissed, type PlanItem } from './load';
import { isBlocked, isStaleBlock, leavesOf, type PlanNode, type PlanSection } from './tree';
import { isModuleId } from '@/lib/modules';
import type { DevProject, PlanScope } from './projects';

/**
 * Where each workspace and project stands, as one of three words and a count,
 * for the status grid on Dev home (plan #2903).
 *
 * - `ready`: at least one step can be started without the person. The count
 *   is how many.
 * - `waiting`: steps are open, and none of them can be: each is underway, or
 *   held by something only the person can clear (a block, a proposal, an
 *   unanswered question or setup job, a check-back), or waits on one that is.
 * - `empty`: nothing is open.
 *
 * Only leaf steps are looked at, and only open ones: not done, not dropped,
 * not dismissed, and not under a dropped or dismissed feature.
 *
 * A step counts when `isReady` says so, and also when all it waits on is a
 * chain of steps that will clear without the person: each one ready, being
 * worked, or itself waiting only on steps like that. The runner works such a
 * chain from the front, so a step behind it is work Dash can get to. One step
 * in the chain that is blocked, proposed, an open question or a setup job, or
 * under a feature that is, waits on the person, and so does every step behind
 * it.
 */

export type ScopeState = 'empty' | 'waiting' | 'ready';

export type ScopeStatus = {
  state: ScopeState;
  /** Open leaf steps that can be started without the person. */
  count: number;
};

export type ScopeStatusRow = ScopeStatus & {
  scope: PlanScope;
  label: string;
  /** The project, for a project's row; null for a workspace. */
  project: DevProject | null;
};

export type ScopeStatuses = {
  /** Every workspace, then every active project, in the plan's own order. */
  scopes: ScopeStatusRow[];
  /** The whole plan, each step counted once. */
  everything: ScopeStatus;
};

type Placed = { node: PlanNode; ancestors: PlanNode[] };

/** A wait on the person above a step: the same reading `isReady` takes. */
function heldAbove(ancestors: readonly Pick<PlanItem, 'status' | 'blockKind' | 'dismissedAt'>[]): boolean {
  return ancestors.some(
    (a) =>
      a.status === 'dropped' ||
      a.status === 'proposed' ||
      isDismissed(a) ||
      (a.status === 'blocked' && (a.blockKind ?? DEFAULT_BLOCK_KIND) !== 'steps'),
  );
}

function isOpenLeaf({ node, ancestors }: Placed): boolean {
  if (isClosed(node.status) || isDismissed(node)) return false;
  return !ancestors.some((a) => a.status === 'dropped' || isDismissed(a));
}

/**
 * The status of every workspace and active project, and of the whole plan.
 *
 * Takes the sections `buildPlanTree` returns, unfiltered: a view's narrowing
 * would hide the steps a chain runs through.
 */
export function scopeStatuses(sections: readonly PlanSection[]): ScopeStatuses {
  const placed = new Map<string, Placed>();
  const place = (node: PlanNode, ancestors: PlanNode[]) => {
    if (!placed.has(node.id)) placed.set(node.id, { node, ancestors });
    node.children.forEach((child) => place(child, [...ancestors, node]));
  };
  for (const section of sections) section.nodes.forEach((node) => place(node, []));

  // Whether a step will clear without the person. Memoised, and false on a
  // cycle, which nothing can work through.
  const clears = new Map<string, boolean>();
  const willClear = (id: string): boolean => {
    const known = clears.get(id);
    if (known !== undefined) return known;
    clears.set(id, false);
    const at = placed.get(id);
    const result = at ? clearsWithoutYou(at) : false;
    clears.set(id, result);
    return result;
  };
  const clearsWithoutYou = ({ node, ancestors }: Placed): boolean => {
    if (isClosed(node.status)) return true;
    if (isDismissed(node) || node.kind !== 'build') return false;
    if (node.status === 'proposed' || isBlocked(node)) return false;
    if (heldAbove(ancestors)) return false;
    if (node.ready) return true;
    if ((node.waitsUntil?.length ?? 0) > 0) return false;
    const open = node.children.filter((child) => !isClosed(child.status) && !isDismissed(child));
    if (open.length > 0) return open.every((child) => willClear(child.id));
    return node.waitingOn.every((ref) => willClear(ref.id));
  };

  const startable = (at: Placed): boolean =>
    at.node.kind === 'build' &&
    (at.node.status === 'not_started' || isStaleBlock(at.node)) &&
    willClear(at.node.id);

  const statusOf = (leaves: readonly PlanNode[]): ScopeStatus => {
    const seen = new Set<string>();
    let open = 0;
    let count = 0;
    for (const leaf of leaves) {
      if (seen.has(leaf.id)) continue;
      seen.add(leaf.id);
      const at = placed.get(leaf.id);
      if (!at || !isOpenLeaf(at)) continue;
      open += 1;
      if (startable(at)) count += 1;
    }
    return { state: count > 0 ? 'ready' : open > 0 ? 'waiting' : 'empty', count };
  };

  const scopes = sections.flatMap((section): ScopeStatusRow[] => {
    const scope = section.module;
    if (scope === null) return [];
    const project = section.project ?? null;
    if (!isModuleId(scope) && (!project || project.archivedAt)) return [];
    return [
      { scope, label: section.label, project, ...statusOf(leavesOf(section.nodes)) },
    ];
  });

  return {
    scopes,
    everything: statusOf(sections.flatMap((section) => leavesOf(section.nodes))),
  };
}
