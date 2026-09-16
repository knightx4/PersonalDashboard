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
import {
  applyView,
  buildPlanTree,
  flattenSections,
  handedToClaude,
  summarize,
} from '@/lib/plan/tree';

// The server actions pull in the session client, which has no business in a
// render test; the page only needs them to exist to hand to its forms.
vi.mock('@/app/dev/plan/actions', () => {
  const noop = async () => ({});
  return {
    addPlanDependency: noop,
    addPlanItem: noop,
    answerPlanDecision: noop,
    approvePlanItem: noop,
    deletePlanItem: noop,
    dismissPlanDecision: noop,
    dismissPlanFog: noop,
    movePlanItem: noop,
    removePlanDependency: noop,
    reshapePlanFeature: noop,
    seedPlan: noop,
    sendPlanFeatureToClaude: noop,
    sendPlanItemToClaude: noop,
    sendPlanQueueToClaude: noop,
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
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    thread: [],
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
      queued={handedToClaude(whole).length}
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
    // Not who has it: the Who column was dropped deliberately -- it was a
    // column of dashes with the occasional "Dash" in it. Who has a step is
    // on the open step, in the "Dash's" view, and in the menu that sets it,
    // and the next two assertions are the ones that cover those. Named for
    // what the label actually renders since the rename -- against "Claude"
    // this passed whether the column was there or not.
    expect(html).not.toContain('>Dash<');
    expect(render('claude')).toContain('The anonymous page');
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
    expect(html).toContain('>1 of 4<');
    // The proposal does not count until it is approved.
    expect(html).toContain('>0 of 1<');
  });

  it('spends the whole bar on the states the steps are actually in', () => {
    const html = render('all');
    // Not one green length and a blank remainder: a module held up by
    // questions and a module nobody has reached drew the same bar.
    expect(html).toContain('aria-label="Shopping: 1 done, 2 ready, 1 waiting"');
    expect(html).toContain('aria-label="Job search: 1 blocked"');
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
    expect(html).toMatch(/>1<\/span> Dash/);
  });

  it('offers the whole queue in one press, and only when there is one', () => {
    // One step is handed over in the fixture, so the button says so rather
    // than making you count.
    expect(render('open')).toContain('Send all 1 to Dash');

    const nobodys = buildPlanTree({
      items: [item({ id: 'mine', title: 'Mine to do' })],
      dependencies: [],
    });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(nobodys, 'all')}
        summary={summarize(nobodys)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        queued={handedToClaude(nobodys).length}
      />,
    );
    expect(html).not.toContain('to Dash</button>');
  });

  it('says on the row which answer produced a step a re-shape wrote', () => {
    const reshaped = buildPlanTree({
      items: [
        item({ id: 'f', title: 'Re-shaping' }),
        item({
          id: 'added',
          title: 'The graduated step',
          parentId: 'f',
          status: 'proposed',
          comment: "From #63's answer: On the server, not the client.",
        }),
        item({ id: 'mine', title: 'Written by hand', parentId: 'f' }),
      ],
      dependencies: [],
    });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(reshaped, 'all')}
        summary={summarize(reshaped)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        queued={0}
      />,
    );

    // Visible without opening the step, which is the whole point: a row that
    // appeared under a feature you approved last week is the one you would
    // never think to open.
    expect(html).toContain('On the server, not the client.');
    expect((html.match(/answer:/g) ?? []).length).toBe(1);
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
        queued={0}
      />,
    );
    expect(html).toContain('Nothing ready right now');
  });

  it('marks a decision as a question and never as ready work', () => {
    // Its own tree, so the counts the other tests pin are left alone. A
    // decision at the top of a module is nobody's question but its own, so it
    // is a row like any other step -- unlike one beneath a step, which is that
    // step's question and belongs to its questions section.
    const withDecision = buildPlanTree({
      items: [
        item({ id: 'export', title: 'Export' }),
        item({ id: 'standalone', title: 'Do we charge for this?', kind: 'decision' }),
        item({ id: 'writer', title: 'The writer', parentId: 'export' }),
      ],
      dependencies: [],
    });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(withDecision, 'all')}
        summary={summarize(withDecision)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        queued={0}
      />,
    );

    // The "?" where a build step's checkbox would be, and the word that says
    // a question is not work waiting to be picked up.
    expect(html).toContain('>Decision<');
    // Not "Ready", which on a question would read as ready to be built.
    expect(html).toContain('>Unanswered<');
    // Only the decision carries the mark; the build steps beside it do not.
    expect((html.match(/>Decision</g) ?? []).length).toBe(1);
  });

  it("keeps a step's questions out of the tree and says how many are unanswered", () => {
    const withQuestions = buildPlanTree({
      items: [
        item({ id: 'export', title: 'Export' }),
        item({ id: 'csv', title: 'CSV or JSON?', parentId: 'export', kind: 'decision' }),
        item({ id: 'split', title: 'One file or many?', parentId: 'export', kind: 'decision' }),
        item({
          id: 'settled',
          title: 'Do we compress it?',
          parentId: 'export',
          kind: 'decision',
          status: 'done',
          resolution: 'No.',
        }),
        item({ id: 'writer', title: 'The writer', parentId: 'export' }),
      ],
      dependencies: [],
    });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(withQuestions, 'all')}
        summary={summarize(withQuestions)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        queued={0}
      />,
    );

    // The questions are answered in the step's own questions section, behind
    // its fold. Not also rows here: the same question in two places, one of
    // which can answer it, is how you answer neither.
    expect(html).not.toContain('CSV or JSON?');
    expect(html).not.toContain('Do we compress it?');
    // The build step beneath it is still a row.
    expect(html).toContain('The writer');
    // And the two that are still open are counted on the row, so nothing hides
    // behind a fold.
    expect(html).toContain('unanswered questions');
    expect(html).toMatch(/2<span class="sr-only">\s*unanswered questions/);
  });

  it('shows what a feature admits it cannot see yet, and nothing when it can', () => {
    const foggy = buildPlanTree({
      items: [
        item({
          id: 'export',
          title: 'Export',
          fog: 'How the second half is shaped is not yet known.',
        }),
        item({ id: 'writer', title: 'The writer', parentId: 'export' }),
      ],
      dependencies: [],
    });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(foggy, 'all')}
        summary={summarize(foggy)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        queued={0}
      />,
    );

    // In the tree, not behind a fold: a plan's own admission that part of it
    // is missing is no use if you have to open a step to find it.
    expect(html).toContain('Not yet specified');
    expect(html).toContain('How the second half is shaped is not yet known.');
    // Exactly once -- the step beneath it has no fog and shows no block.
    expect((html.match(/Not yet specified/g) ?? []).length).toBe(1);
    // And a plan with none of it anywhere says nothing at all.
    expect(render('all')).not.toContain('Not yet specified');
  });

  it('says nothing about a patch of fog that has been put aside', () => {
    const aside = buildPlanTree({
      items: [
        item({
          id: 'export',
          title: 'Export',
          fog: 'How the second half is shaped is not yet known.',
          fogDismissedAt: '2026-09-13T00:00:00Z',
        }),
      ],
      dependencies: [],
    });
    const at = (view: 'all' | 'dismissed') =>
      renderToStaticMarkup(
        <PlanView
          sections={applyView(aside, view)}
          summary={summarize(aside)}
          view={view}
          catalog={[]}
          empty={false}
          canSend={false}
          queued={0}
        />,
      );

    expect(at('all')).not.toContain('How the second half is shaped is not yet known.');
    // Under Dismissed it is shown again, with the one move back.
    expect(at('dismissed')).toContain('How the second half is shaped is not yet known.');
    expect(at('dismissed')).toContain('Bring back');
  });

  it('finds a question put aside, with the way back, under Dismissed', () => {
    const aside = buildPlanTree({
      items: [
        item({ id: 'feature', title: 'Talking back' }),
        item({
          id: 'question',
          title: 'Which shape for the reply?',
          parentId: 'feature',
          kind: 'decision',
          dismissedAt: '2026-09-13T00:00:00Z',
        }),
      ],
      dependencies: [],
    });
    const at = (view: 'open' | 'dismissed') =>
      renderToStaticMarkup(
        <PlanView
          sections={applyView(aside, view)}
          summary={summarize(aside)}
          view={view}
          catalog={[]}
          empty={false}
          canSend={false}
          queued={0}
        />,
      );

    expect(at('open')).not.toContain('Which shape for the reply?');
    // The step it hangs off opens itself here: a question lives in its step's
    // panel, so a Dismissed view of closed rows would be a list to click
    // through one at a time.
    const dismissed = at('dismissed');
    expect(dismissed).toContain('Which shape for the reply?');
    expect(dismissed).toContain('Bring back');
  });

  it('opens on the import when there is no plan at all', () => {
    expect(render('open', true)).toContain('Import the build order');
  });
});
