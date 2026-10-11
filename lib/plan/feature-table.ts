/**
 * The plan as a table of features (plan #1669): one row per open feature,
 * grouped by module, for reading across the plan at a glance rather than
 * down one tree.
 *
 * Pure, so the page and its tests agree on which features are listed and
 * what each row's numbers are. The health is the derived one the tree's
 * health column shows (`healthOf` in lib/plan/tree.ts), so the two views
 * cannot disagree about a feature.
 */
import { isClosed, isDismissed } from './load';
import { flatten, healthOf, isFinishedFeature, leavesOf } from './tree';
import type { PlanHealth, PlanLiveness, PlanNode, PlanSection } from './tree';
import type { HealthFacts } from './health-words';
import type { PlanScope } from './projects';

export type FeatureRow = {
  node: PlanNode;
  health: PlanHealth;
  /** The steps beneath it with no steps of their own, not done or dropped. */
  openSteps: number;
  /** Done over the live steps beneath it, 0 to 100; null with none to count. */
  percent: number | null;
};

export type FeatureGroup = {
  module: PlanScope | null;
  label: string;
  rows: FeatureRow[];
};

/** The facts a feature's health tooltip needs, as the tree row reads them. */
export function featureHealthFacts(node: PlanNode): HealthFacts {
  return {
    closed: isClosed(node.status),
    openBeneath: flatten(node.children).filter((child) => !isClosed(child.status)),
    resolution: node.resolution,
    blockAsk: node.blockAsk,
    comment: node.comment,
    waitingOn: node.waitingOn,
  };
}

/** One feature as a row of the table. */
export function featureRow(node: PlanNode, liveness?: PlanLiveness): FeatureRow {
  const fraction = node.rollup.fraction;
  return {
    node,
    health: healthOf(node, liveness),
    openSteps: leavesOf(node.children).filter(
      (leaf) => !isClosed(leaf.status) && !isDismissed(leaf),
    ).length,
    percent: fraction === null ? null : Math.round(fraction * 100),
  };
}

/**
 * Every open feature, by module in the plan's own order.
 *
 * Open means what it means on the Open view: not finished, so a closed
 * feature with work still open beneath it stays. A feature put aside stays
 * out, as it does everywhere but the Dismissed view, and a module with no
 * open feature has no group.
 */
export function featureTable(
  sections: readonly PlanSection[],
  liveness?: PlanLiveness,
): FeatureGroup[] {
  return sections
    .map((section) => ({
      module: section.module,
      label: section.label,
      rows: section.nodes
        .filter((node) => !isFinishedFeature(node) && !isDismissed(node))
        .map((node) => featureRow(node, liveness)),
    }))
    .filter((group) => group.rows.length > 0);
}

/** How many rows the table lists. */
export function featureCount(groups: readonly FeatureGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}
