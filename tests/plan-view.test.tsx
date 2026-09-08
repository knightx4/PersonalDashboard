/**
 * The plan page, rendered.
 *
 * The tree logic is pinned in lib/plan/tree.test.ts; this is the other half
 * -- that the page shows what the tree says, nested, with the facts that
 * change what gets picked up next on the line, and that the empty states say
 * what they mean. Rendered rather than asserted about, because a chip that
 * the logic computes and the page forgets to show is the kind of gap a unit
 * test on the logic cannot see.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import { applyView, buildPlanTree, flattenSections, summarize } from '@/lib/plan/tree';

// The server actions pull in the session client, which has no business in a
// render test; the page only needs them to exist to hand to its forms.
vi.mock('@/app/dev/plan/actions', () => {
  const noop = async () => ({});
  return {
    addPlanDependency: noop,
    addPlanItem: noop,
    approvePlanItem: noop,
    deletePlanItem: noop,
    movePlanItem: noop,
    removePlanDependency: noop,
    seedPlan: noop,
    sendPlanItemToClaude: noop,
    setPlanItemAssignee: noop,
    setPlanItemStatus: noop,
    updatePlanItem: noop,
  };
});

const { PlanView } = await import('@/app/dev/plan/plan-view');

let counter = 0;

function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'shopping',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    comment: null,
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

const dep = (itemId: string, dependsOnId: string): PlanDependency => ({
  id: `${itemId}->${dependsOnId}`,
  itemId,
  dependsOnId,
});

const whole = buildPlanTree({
  items: [
    item({ id: 'feature', title: 'Share links', priority: 1, size: 'l' }),
    item({ id: 'schema', title: 'Schema and RPCs', parentId: 'feature', status: 'done' }),
    item({
      id: 'page',
      title: 'The anonymous page',
      parentId: 'feature',
      assignee: 'claude',
      size: 'm',
      comment: 'Waiting on the RPC review.',
    }),
    item({ id: 'form', title: 'The keep or sell form', parentId: 'feature' }),
    item({ id: 'deletion', title: 'Account deletion', priority: 3 }),
    item({ id: 'stuck', title: 'Outlook ingestion', module: 'jobs', status: 'blocked' }),
    item({ id: 'maybe', title: 'Receipts by photo', module: 'jobs', status: 'proposed' }),
  ],
  dependencies: [dep('page', 'schema'), dep('form', 'page')],
});

const catalog = flattenSections(whole).map((node) => ({
  id: node.id,
  number: node.number,
  title: node.title,
  module: node.module,
  parentId: node.parentId,
  depth: node.depth,
  closed: node.status === 'done' || node.status === 'dropped',
}));

function render(view: 'all' | 'open' | 'ready' | 'proposed' | 'claude' | 'blocked', empty = false) {
  return renderToStaticMarkup(
    <PlanView
      sections={applyView(whole, view)}
      summary={summarize(whole)}
      view={view}
      catalog={catalog}
      empty={empty}
      canSend={false}
    />,
  );
}

describe('PlanView', () => {
  it('shows the steps nested under their feature, with their numbers', () => {
    const html = render('open');
    expect(html).toContain('Share links');
    expect(html).toContain('#1');
    expect(html).toContain('The anonymous page');
    expect(html).toContain('#3');
    // The done schema step is not on the open view; the feature that holds
    // the open ones is.
    expect(html).not.toContain('Schema and RPCs');
    expect(render('all')).toContain('Schema and RPCs');
  });

  it('puts the facts that decide what is next on the line', () => {
    const html = render('open');
    expect(html).toContain('>Next<');
    expect(html).toContain('>Someday<');
    expect(html).toContain('>Claude<');
    expect(html).toContain('>Ready<');
    expect(html).toContain('Waits on #3');
    // One of the feature's three leaf steps is done; the rest are not started.
    expect(html).toContain('1 done, 2 not started of 3');
    // The note stands in for the missing detail under the title.
    expect(html).toContain('Note: Waiting on the RPC review.');
  });

  it('lays every depth out on the same columns, with the tree drawn in the name cell', () => {
    const html = render('open');
    expect(html).toContain('>Health<');
    expect(html).toContain('>Steps<');
    // The sub-steps carry a guide line; the feature at the top does not.
    expect((html.match(/bg-border-strong/g) ?? []).length).toBeGreaterThan(0);
  });

  it('measures each module over its leaves and says so', () => {
    const html = render('all');
    expect(html).toContain('Shopping: 1 of 4 done');
    // The proposal does not count until it is approved.
    expect(html).toContain('Job search: 0 of 1 done');
  });

  it('shows a proposal as one, and offers only proposals under that view', () => {
    const html = render('proposed');
    expect(html).toContain('>Proposed<');
    expect(html).toContain('Receipts by photo');
    expect(html).not.toContain('Outlook ingestion');
    expect(html).toContain('href="/dev/plan?view=proposed"');
  });

  it('offers every view as a link, and the counts behind them', () => {
    const html = render('open');
    for (const view of ['ready', 'claude', 'blocked', 'all']) {
      expect(html).toContain(`href="/dev/plan?view=${view}"`);
    }
    expect(html).toContain('href="/dev/plan"');
    expect(html).toMatch(/>2<\/span> ready/);
    expect(html).toMatch(/>1<\/span> Claude/);
  });

  it('invites a step at the top of every module on the working view, and not on the narrow ones', () => {
    expect(render('open')).toContain('Add a step');
    expect(render('ready')).not.toContain('Add a step');
  });

  it('says plainly when a narrow view has nothing in it', () => {
    const nothing = buildPlanTree({ items: [item({ id: 'a', title: 'Underway', status: 'in_progress' })], dependencies: [] });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(nothing, 'ready')}
        summary={summarize(nothing)}
        view="ready"
        catalog={[]}
        empty={false}
        canSend={false}
      />,
    );
    expect(html).toContain('Nothing ready right now');
  });

  it('opens on the import when there is no plan at all', () => {
    expect(render('open', true)).toContain('Import the build order');
  });
});
