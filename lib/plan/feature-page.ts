import type { Crumb } from '@/components/shell/breadcrumb';
import { planRowId } from '@/lib/comments/refs';
import { isProjectId, type PlanScope } from '@/lib/plan/projects';
import {
  flatten,
  healthOf,
  type PlanHealth,
  type PlanLiveness,
  type PlanNode,
  type PlanSection,
} from '@/lib/plan/tree';
import { isClosed, type PlanStatus } from '@/lib/plan/load';
import type { Tab } from '@/lib/tabs';

/**
 * A feature's own page, /dev/plan/<number> (plan #1664): where it is, which
 * feature a number belongs to, and the tabs it has.
 *
 * Pure, so the page, the plan row's title link and the tests read the same
 * answers. The page is drawn by app/dev/plan/[number]/ and feature-page.tsx.
 */

/** The address of a feature's page. */
/**
 * The status a feature page shows. A feature's stored status is only ever
 * claimed or closed by a session, so one whose step is underway still reads
 * not started; the page rolls it up from the steps, the way its health does.
 */
/**
 * What the feature page calls the fact and the column that say whose move a
 * step is. Not "Waiting on": a cell there already reads "Waiting on #935",
 * Health has its own "Waiting", and the overview says "Waits on" of a
 * dependency, so the three would be one word for three things.
 */
export const MOVE_LABEL = 'Whose move';

export function featureStatus(node: PlanNode): PlanStatus {
  const underway = flatten(node.children).some((step) => step.status === 'in_progress');
  return node.status === 'not_started' && underway ? 'in_progress' : node.status;
}

export function featureHref(number: number): string {
  return `/dev/plan/${number}`;
}

/**
 * The query that opens the "New feature" surface at the top of /dev/plan
 * (plan #1670), so the header's press is a link.
 */
export const NEW_FEATURE_PARAM = 'new';
export const NEW_FEATURE_VALUE = 'feature';

/** The plan page with the "New feature" surface open, keeping the view it was pressed from. */
export function newFeatureHref(basePath: string, view?: string | null): string {
  const query = new URLSearchParams(view ? { view } : {});
  query.set(NEW_FEATURE_PARAM, NEW_FEATURE_VALUE);
  return `${basePath}?${query}`;
}

/** The anchor of a module's section on /dev/plan, which its crumb lands on. */
export function moduleAnchor(module: PlanScope | null): string {
  return `plan-module-${module ?? 'app'}`;
}

/**
 * The tabs, in order. Overview is the plain address. Activity (plan #1667)
 * is the feature's history, newest first.
 */
export const FEATURE_TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'steps', label: 'Steps' },
];

/**
 * The feature a number belongs to, and the row it names.
 *
 * A feature is a row at the top of its module. A step's or substep's number
 * finds the feature above it, so `/dev/plan/1664` and `/dev/plan/1660` open
 * the same page, the first scrolled to that step. Null when no row has the
 * number.
 */
export function findFeature(
  sections: readonly PlanSection[],
  number: number,
): { feature: PlanNode; target: PlanNode; module: PlanScope | null; moduleLabel: string } | null {
  for (const section of sections) {
    for (const top of section.nodes) {
      const target = flatten([top]).find((node) => node.number === number);
      if (target) {
        return { feature: top, target, module: section.module, moduleLabel: section.label };
      }
    }
  }
  return null;
}

/**
 * Where a number that names a step sends you: its feature's Steps tab,
 * scrolled to the step's row. Null when the number is the feature's own.
 */
export function stepRedirect(feature: PlanNode, target: PlanNode): string | null {
  if (feature.id === target.id) return null;
  return `${featureHref(feature.number)}?tab=steps#${planRowId(target.number)}`;
}

/**
 * Where an "After #…" on a step goes: the waited-on step's row, by its anchor
 * when it is on the same feature's page, or through its number, which opens
 * its own feature's Steps tab at it, when it is elsewhere on the plan.
 */
export function waitedOnHref(
  step: Pick<PlanNode, 'outline'>,
  on: Pick<PlanNode, 'number'> & { outline?: string },
): string {
  const featureOf = (outline: string | undefined) => outline?.split('.')[0];
  return on.outline && featureOf(on.outline) === featureOf(step.outline)
    ? `#${planRowId(on.number)}`
    : featureHref(on.number);
}

/**
 * The longest a feature's title runs as the last crumb before it is cut at a
 * word. The title is printed in full right under the crumbs, so the crumb
 * only has to say which feature this is.
 */
export const CRUMB_TITLE_LENGTH = 32;

/** A title cut to `CRUMB_TITLE_LENGTH` at a word, with an ellipsis when cut. */
export function crumbTitle(title: string): string {
  const plain = title.trim();
  if (plain.length <= CRUMB_TITLE_LENGTH) return plain;
  const cut = plain.slice(0, CRUMB_TITLE_LENGTH);
  const space = cut.lastIndexOf(' ');
  const word = space > CRUMB_TITLE_LENGTH / 2 ? cut.slice(0, space) : cut;
  return `${word.replace(/[\s,.;:–—-]+$/, '')}…`;
}

/**
 * Dev, Plan, the module, then the feature's short title (plan #1688). A
 * project such as the website has a page of its own in Dev, so its crumb
 * goes there; a module's goes to its section on the plan. The module's crumb
 * is left out when it says the same as one before it, so a Dev feature reads
 * Dev › Plan › its title rather than Dev › Plan › Dev › #925. The last crumb
 * was the number while the title went in uncut, because a long title
 * squeezed the module's crumb to nothing on a phone; `crumbTitle` cuts it
 * short instead.
 */
export function featureCrumbs(
  feature: Pick<PlanNode, 'number' | 'title'>,
  module: PlanScope | null,
  moduleLabel: string,
): Crumb[] {
  const start: Crumb[] = [
    { label: 'Dev', href: '/dev' },
    { label: 'Plan', href: '/dev/plan' },
  ];
  const label = moduleLabel.trim();
  const repeats = !label || start.some((crumb) => crumb.label.toLowerCase() === label.toLowerCase());
  const moduleCrumb: Crumb[] = repeats
    ? []
    : [
        {
          label,
          href:
            module && isProjectId(module)
              ? `/dev/projects/${module}`
              : `/dev/plan#${moduleAnchor(module)}`,
        },
      ];
  return [
    ...start,
    ...moduleCrumb,
    { label: crumbTitle(feature.title), href: featureHref(feature.number) },
  ];
}

/**
 * How the Steps tab lays the steps out (plan #1665): grouped by status, which
 * is the plain Steps tab, or as the plan's tree, one press away. Kept in the
 * address beside the tab so a reload keeps the view.
 */
export const STEPS_VIEW_PARAM = 'view';
export const STEPS_VIEWS = ['status', 'tree'] as const;
export type StepsView = (typeof STEPS_VIEWS)[number];

/** The view a `?view=` value opens: the tree when it says so, otherwise the groups. */
export function stepsViewFrom(value: string | null | undefined): StepsView {
  return value === 'tree' ? 'tree' : 'status';
}

/** The address of the Steps tab in a given view. */
export function stepsViewHref(number: number, view: StepsView): string {
  const base = `${featureHref(number)}?tab=steps`;
  return view === 'tree' ? `${base}&${STEPS_VIEW_PARAM}=tree` : base;
}

/** The groups, in the order they are listed. Done and dropped start folded. */
export const STEP_GROUPS = [
  { id: 'blocked', label: 'Blocked', folded: false },
  { id: 'in_progress', label: 'In progress', folded: false },
  { id: 'ready', label: 'Ready', folded: false },
  { id: 'not_started', label: 'Not started', folded: false },
  { id: 'done', label: 'Done', folded: true },
  { id: 'dropped', label: 'Dropped', folded: true },
] as const;
export type StepGroupId = (typeof STEP_GROUPS)[number]['id'];

/**
 * The group a health word falls in. Read off `healthOf` so a step is listed
 * under the word its own row shows: a setup job of yours or an unanswered
 * question holds work up as a block does, a claim is in progress however
 * lively its run, and a step waiting on another step or still proposed has
 * not started.
 */
export function stepGroupOf(health: PlanHealth): StepGroupId {
  switch (health) {
    case 'blocked':
    case 'setup':
    case 'unanswered':
      return 'blocked';
    case 'in_progress':
    case 'working':
    case 'quiet':
    case 'abandoned':
      return 'in_progress';
    case 'ready':
      return 'ready';
    case 'done':
    case 'answered':
      return 'done';
    case 'dropped':
      return 'dropped';
    default:
      return 'not_started';
  }
}

/** A step in a group, with the step above it when it is a substep. */
export type GroupedStep = {
  node: PlanNode;
  /** Named by its outline, `#925.3`, as its row heads itself. */
  parent: Pick<PlanNode, 'number' | 'outline' | 'title'> | null;
  /**
   * The open step on this feature it waits on, when it is listed straight
   * beneath that step rather than in a group of its own. Null otherwise.
   */
  after: Pick<PlanNode, 'number' | 'outline' | 'title'> | null;
};

export type StepGroup = {
  id: StepGroupId;
  label: string;
  folded: boolean;
  steps: GroupedStep[];
};

/**
 * A feature's steps and substeps in status groups, each listed once, in the
 * tree's own order. A row is grouped by its own status, not by what is open
 * beneath it: its substeps are listed in their own groups. Questions are not
 * rows of their own, as in the tree; they stay with the step they were asked
 * on. Groups with nothing in them are not returned. `only` keeps just the
 * steps whose ids it holds (the Steps tab filtered by who holds them, plan
 * #1668), their substeps still looked through.
 *
 * A step that waits on another open step listed here goes straight beneath
 * that step, in its group, rather than into Not started on its own: filed
 * there, "After #1673.2" was the only sign of what it was waiting for, and
 * the step it named was in a different group. Waiting on several, it goes
 * under the last of them in the tree's order, the one it can start after.
 */
export function stepGroups(
  feature: PlanNode,
  liveness?: PlanLiveness,
  only?: ReadonlySet<string>,
): StepGroup[] {
  const found: GroupedStep[] = [];
  const walk = (nodes: readonly PlanNode[], parent: PlanNode | null) => {
    for (const node of nodes) {
      if (node.kind === 'decision') continue;
      if (only && !only.has(node.id)) {
        walk(node.children, node);
        continue;
      }
      found.push({
        node,
        parent: parent && { number: parent.number, outline: parent.outline, title: parent.title },
        after: null,
      });
      walk(node.children, node);
    }
  };
  walk(feature.children, null);

  // The step each one is listed beneath, by id, when it waits on one here.
  const order = new Map(found.map((step, index) => [step.node.id, index]));
  const under = new Map<string, string>();
  for (const step of found) {
    if (isClosed(step.node.status)) continue;
    const targets = step.node.dependsOn
      .map((link) => link.item)
      .filter((ref) => !isClosed(ref.status) && order.has(ref.id));
    const last = targets.sort((a, b) => order.get(a.id)! - order.get(b.id)!).at(-1);
    if (last) under.set(step.node.id, last.id);
  }
  // A loop of waits has no first step to hang the rest from; each of its
  // steps keeps its own group instead.
  for (const id of [...under.keys()]) {
    const seen = new Set<string>();
    let at: string | undefined = id;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      at = under.get(at);
    }
    if (at !== undefined) seen.forEach((looped) => under.delete(looped));
  }
  const waiters = new Map<string, GroupedStep[]>();
  const byId = new Map(found.map((step) => [step.node.id, step]));
  for (const step of found) {
    const target = under.get(step.node.id);
    if (!target) continue;
    const of = byId.get(target)!.node;
    step.after = { number: of.number, outline: of.outline, title: of.title };
    waiters.set(target, [...(waiters.get(target) ?? []), step]);
  }
  const withWaiters = (step: GroupedStep): GroupedStep[] => [
    step,
    ...(waiters.get(step.node.id) ?? []).flatMap(withWaiters),
  ];

  return STEP_GROUPS.map((group) => ({
    ...group,
    steps: found
      .filter(({ node }) => !under.has(node.id))
      .filter(({ node }) => stepGroupOf(healthOf(asListed(node), liveness)) === group.id)
      .flatMap(withWaiters),
  })).filter((group) => group.steps.length > 0);
}

/**
 * A step as the grouped list draws it: its questions kept, since they are
 * answered from its panel, and its substeps taken off, since they are listed
 * in their own groups. Its health is then the word its row shows.
 */
export function asListed(node: PlanNode): PlanNode {
  return { ...node, children: node.children.filter((child) => child.kind === 'decision') };
}
