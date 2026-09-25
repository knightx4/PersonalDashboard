import { PlanView, type PlanCatalogEntry } from '@/app/dev/plan/plan-view';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import {
  applyView,
  buildPlanTree,
  flattenSections,
  summarize,
  type PlanSection,
} from '@/lib/plan/tree';

/**
 * The dev plan, drawn from fixtures for the gallery (plan #993).
 *
 * Here so the plan page can be photographed before and after a change to how
 * its rows are drawn: #980 moves the row and the tree into shared components,
 * and the check that nothing moved is that these shots do not change. Every
 * state a row can be in is somewhere in the tree -- a feature with fog, one
 * with a question beneath it, a proposal, a block, a setup job, a step
 * waiting on another, a finished step and a dropped one.
 *
 * No clock anywhere in it. A step underway carries no start time, because the
 * row would print how long it has been going and two shots taken minutes
 * apart would differ for that reason alone.
 */

let counter = 900;

function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'goals',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-09-01T09:00:00Z',
    ...over,
  };
}

const dep = (itemId: string, dependsOnId: string): PlanDependency => ({
  id: `${itemId}->${dependsOnId}`,
  itemId,
  dependsOnId,
});

const items: PlanItem[] = [
  item({
    id: 'goal-tree',
    title: 'Make the goal page use the dev plan’s tree',
    detail:
      'Goals looks and works like the dev plan because it is drawn by the same components.',
    acceptance: 'A goal page and /dev/plan read the same at phone and laptop width.',
    priority: 1,
    size: 'l',
  }),
  item({
    id: 'shared',
    parentId: 'goal-tree',
    title: 'Move the plan row and tree into shared components',
    detail: 'The dev plan looks and works exactly as it does now.',
    acceptance: 'The dev plan renders through the shared components.',
    status: 'in_progress',
    size: 'l',
  }),
  item({
    id: 'gallery',
    parentId: 'shared',
    title: 'Show the dev plan in the preview gallery',
    status: 'done',
    size: 's',
    commitSha: 'a1b2c3d',
    completedAt: '2026-09-24T10:00:00Z',
    startedAt: '2026-09-24T09:00:00Z',
  }),
  item({
    id: 'words',
    parentId: 'shared',
    title: 'Move plan health and move wording into a pure module',
    size: 's',
  }),
  item({
    id: 'blocked-steps',
    parentId: 'goal-tree',
    title: 'Let goal steps be blocked and wait on other steps',
    detail: 'A goal step can be blocked with a one-line reason saying what it needs.',
    size: 'm',
    comment: 'Waiting on the shared row.',
  }),
  item({
    id: 'which-shape',
    parentId: 'blocked-steps',
    kind: 'decision',
    title: 'Which table holds a goal step’s dependencies?',
    detail:
      'A — A goals.dependencies table. Mirrors plan_dependencies.\nB — A column on the step. Simpler, holds one.\nRecommend A.',
  }),
  item({
    id: 'render',
    parentId: 'goal-tree',
    title: 'Render the goal page through the plan tree',
    size: 'm',
    assignee: 'me',
  }),
  item({
    id: 'fog-feature',
    title: 'Plan a week around the goals',
    fog: 'Which goals get a slot each week is not settled.',
    status: 'proposed',
    priority: 3,
  }),
  item({
    id: 'stuck',
    title: 'Import reading lists from the library',
    status: 'blocked',
    blockKind: 'outside',
    blockAsk: 'Which library account should it read?',
    detail: 'Reads the loans and holds from the library account.',
  }),
  item({
    id: 'key',
    parentId: 'stuck',
    kind: 'setup',
    title: 'Set LIBRARY_TOKEN in Vercel',
    detail: 'Project settings, Environment variables, add LIBRARY_TOKEN for Production.',
    assignee: 'me',
  }),
  item({
    id: 'gone',
    parentId: 'stuck',
    title: 'Scrape the catalogue page',
    status: 'dropped',
    completedAt: '2026-09-20T10:00:00Z',
  }),
];

const whole = buildPlanTree({
  items,
  dependencies: [dep('render', 'shared'), dep('blocked-steps', 'shared')],
});

function catalogOf(tree: PlanSection[]): PlanCatalogEntry[] {
  return flattenSections(tree).map((node) => ({
    id: node.id,
    number: node.number,
    outline: node.outline,
    title: node.title,
    module: node.module,
    parentId: node.parentId,
    depth: node.depth,
    status: node.status,
    completedAt: node.completedAt,
    closed: node.status === 'done' || node.status === 'dropped',
  }));
}

const catalog = catalogOf(whole);

/** The open view, every feature unfolded: the page as a list. */
export function PlanTreeSurface() {
  return (
    <PlanView
      sections={applyView(whole, 'open')}
      finished={[]}
      summary={summarize(whole)}
      view="open"
      catalog={catalog}
      empty={false}
      canSend={false}
      lastRuns={{}}
      commitChecks={{}}
      unfolded
    />
  );
}

/**
 * Two features with every row opened: the panel behind a row, which is where
 * the detail, the questions, the dependencies and the thread are drawn.
 */
export function PlanOpenedSurface() {
  const sections = applyView(whole, 'open')
    .map((section) => ({
      ...section,
      nodes: section.nodes.filter((node) => node.id === 'stuck' || node.id === 'goal-tree'),
    }))
    .filter((section) => section.nodes.length > 0);

  return (
    <PlanView
      sections={sections}
      finished={[]}
      summary={summarize(whole)}
      view="open"
      catalog={catalog}
      empty={false}
      canSend={false}
      lastRuns={{}}
      commitChecks={{}}
      unfolded
      opened
    />
  );
}
