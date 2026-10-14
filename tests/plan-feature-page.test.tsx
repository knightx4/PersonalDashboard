/**
 * A feature's own page, rendered (plan #1664): the crumbs, the tabs, the
 * properties, and the row's presses in the header, so anything done to a
 * feature from its row on /dev/plan can be done here too.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';

// The Tooltip draws its text only while it shows, so these renders read it
// from a title on a stand-in instead (plan #1985.5).
vi.mock('@/components/ui/tooltip', async () => {
  const { createElement } = await import('react');
  return {
    Tooltip: ({ label, children }: { label: string; children: React.ReactNode }) =>
      createElement('span', { title: label }, children),
  };
});


vi.mock('@/app/dev/plan/actions', () => {
  const noop = async () => ({});
  return {
    addPlanDependency: noop,
    addPlanItem: noop,
    answerPlanDecision: noop,
    approvePlanItem: noop,
    deletePlanItem: noop,
    dismissPlanDecision: noop,
    movePlanItem: noop,
    removePlanDependency: noop,
    reshapePlanFeature: noop,
    sendPlanFeatureToClaude: noop,
    sendPlanItemToClaude: noop,
    setPlanItemAssignee: noop,
    setPlanItemPriority: noop,
    setPlanItemStatus: noop,
    updatePlanItem: noop,
    workPlanOverhaul: noop,
  };
});

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dev/plan/1',
  useSearchParams: () => new URLSearchParams(search),
}));

const { FeaturePage } = await import('@/app/dev/plan/feature-page');
const { catalogOf } = await import('@/app/dev/plan/plan-catalog');

let counter = 0;
function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'dev',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    resolution: null,
    dismissedAt: null,
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
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const tree = buildPlanTree({
  items: [
    item({
      id: 'f',
      title: 'Feature pages',
      detail: 'Each feature opens to its own page.',
      acceptance: 'Every feature has a page.',
      priority: 1,
      size: 'l',
      status: 'in_progress',
      startedAt: '2026-10-07T09:00:00Z',
    }),
    item({ id: 'q', title: 'Folded or unfolded?', parentId: 'f', kind: 'decision' }),
    item({ id: 's', title: 'Draw the Overview', parentId: 'f' }),
    item({ id: 'ss', title: 'Photograph it', parentId: 's' }),
  ],
  dependencies: [],
});
const section = tree.find((s) => s.module === 'dev')!;
const feature = section.nodes[0];

function render(tab = '', extra = '') {
  search = [tab ? `tab=${tab}` : '', extra].filter(Boolean).join('&');
  return renderToStaticMarkup(
    <FeaturePage
      feature={feature}
      module={section.module}
      moduleLabel={section.label}
      catalog={catalogOf(tree)}
      canSend={false}
      lastRuns={{}}
      commitChecks={{}}
    />,
  );
}

describe('the feature page', () => {
  it('reads Dev, Plan, then the feature, with the tabs under the title', () => {
    const html = render();
    expect(html).toContain('href="/dev"');
    // The Dev module's crumb would say Dev twice, so it is left out (plan #1688).
    expect(html).not.toContain('href="/dev/plan#plan-module-dev"');
    expect(html).toMatch(/href="\/dev\/plan\/1"[^>]*>(<[^>]+>)*Feature pages</);
    expect(html).toContain('>Overview<');
    expect(html).toContain('href="/dev/plan/1?tab=steps"');
  });

  it('opens on the Overview: the detail, the done-when, the questions and the thread', () => {
    const html = render();
    expect(html).toContain('Each feature opens to its own page.');
    expect(html).toContain('Every feature has a page.');
    expect(html).toContain('Folded or unfolded?');
    // The steps are on their own tab.
    expect(html).not.toContain('Draw the Overview');
  });

  it("offers the row's presses: status and priority as menus, Send and the menu", () => {
    const html = render();
    expect(html).toContain('Status of #1 Feature pages');
    expect(html).toContain('Priority of #1 Feature pages');
    expect(html).toContain('Actions for #1');
    // "Send to Dash" on the button, the count of rows beneath in its title.
    expect(html).toContain('Send to Dash');
    expect(html).toContain('title="Send #1');
    expect(html).toContain('Started');
    expect(html).toContain('2026-10-07');
  });

  it('lists the steps and their substeps on the Steps tab, each at its own anchor', () => {
    const html = render('steps');
    expect(html).toContain('id="plan-3"');
    expect(html).toContain('id="plan-4"');
    expect(html).toContain('Photograph it');
    // A step's title folds in place; only a feature's links away.
    expect(html).not.toContain('href="/dev/plan/3"');
    expect(html).toContain('Add a step');
  });

  it('groups the steps by status, each once, with a substep naming its step', () => {
    const html = render('steps');
    // A group's heading is its name and its count.
    expect(html).toMatch(/<span>Ready<\/span><span class="tabular/);
    expect(html).not.toMatch(/<span>Blocked<\/span>/);
    // Listed once each, not again inside their step.
    expect(html.split('id="plan-4"').length).toBe(2);
    expect(html).toMatch(/Under #[\d.]+ Draw the Overview/);
    expect(html).toContain('href="/dev/plan/1?tab=steps&amp;view=tree"');
  });

  it('draws the tree instead when the Tree chip is on', () => {
    const html = render('steps', 'view=tree');
    expect(html).toContain('Photograph it');
    expect(html).not.toContain('Under #');
    expect(html).not.toMatch(/<span>Ready<\/span><span class="tabular/);
  });
});
