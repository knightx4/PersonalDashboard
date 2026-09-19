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
import type { PlanSection } from '@/lib/plan/tree';
import type { LastRun } from '@/lib/plan/run-end';
import type { RunRaise } from '@/lib/plan/work';
import {
  applyView,
  buildPlanTree,
  splitFinished,
  flattenSections,
  handedToClaude,
  planLiveness,
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
    setPlanItemPriority: noop,
    setPlanItemStatus: noop,
    updatePlanItem: noop,
  };
});

const { PlanView } = await import('@/app/dev/plan/plan-view');
type PlanCatalogEntry = Parameters<typeof PlanView>[0]['catalog'][number];

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
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
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

/** The catalog the page builds: every step in the plan, however it is viewed. */
function catalogOf(tree: PlanSection[]): PlanCatalogEntry[] {
  return flattenSections(tree).map((node) => ({
    id: node.id,
    number: node.number,
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

function render(
  view: 'all' | 'open' | 'ready' | 'proposed' | 'claude' | 'blocked',
  empty = false,
  // The page folds every feature, and a folded row renders no children at all.
  // These tests are about how a nested row is laid out, so they ask for the
  // rows to be open; the one test that is about the fold itself passes false.
  unfolded = true,
) {
  const narrowed = applyView(whole, view);
  // The page splits the finished features out of Everything before it renders;
  // this has to do the same or the fold is never under test.
  const { sections, finished } =
    view === 'all' ? splitFinished(narrowed) : { sections: narrowed, finished: [] };
  return renderToStaticMarkup(
    <PlanView
      sections={sections}
      finished={finished}
      summary={summarize(whole)}
      view={view}
      catalog={catalog}
      empty={empty}
      canSend={false}
      lastRuns={{}}
      commitChecks={{}}
      queued={handedToClaude(whole).length}
      unfolded={unfolded}
    />,
  );
}

describe('PlanView', () => {
  it('starts every feature folded, so the first screen is the map and not the detail', () => {
    const html = render('open', false, false);
    // The feature is there, and says how much is under it.
    expect(html).toContain('Share links');
    // Its steps are not rendered at all until the arrow is pressed.
    expect(html).not.toContain('The anonymous page');
    expect(html).not.toContain('The keep or sell form');
    // A feature with no children has no fold to be on the wrong side of.
    expect(html).toContain('Account deletion');
  });

  it('shows the steps nested under their feature, with their numbers', () => {
    const html = render('open');
    expect(html).toContain('Share links');
    expect(html).toContain('#1');
    expect(html).toContain('The anonymous page');
    // Note 4ff04135: a step is numbered by its place under its feature. The
    // done first step is filtered out of this view and the ones left keep the
    // numbers they had -- a filter does not renumber the plan.
    expect(html).toContain('#1.2');
    expect(html).toContain('#1.3');
    // Its own number is still the handle, on the button that opens it.
    expect(html).toContain('Open #3');
    // The done schema step is not on the open view; the feature that holds
    // the open ones is.
    expect(html).not.toContain('Schema and RPCs');
    expect(render('all')).toContain('Schema and RPCs');
  });

  it('makes priority a word on the row you click, not a form you open', () => {
    // Note 3bfb2749: it was a label, and changing it meant opening the step
    // and going through the edit form for one of three values.
    const html = render('open');
    // Every row, whatever it is set to, and named so the menu says which step
    // it belongs to.
    expect(html).toContain('Priority of #1 Share links');
    expect(html).toContain('Priority of #5 Account deletion');
    // The word itself is what carries the press.
    expect(html).toContain('>Next</span>');
    expect(html).toContain('>Someday</span>');
  });

  it('gathers the finished features into the fold at the foot of Everything', () => {
    const closed = buildPlanTree({
      items: [
        item({
          id: 'shipped',
          title: 'Share links',
          status: 'done',
          completedAt: '2026-02-01T00:00:00Z',
        }),
        item({ id: 'shipped-step', title: 'The RPCs', parentId: 'shipped', status: 'done' }),
        item({
          id: 'older',
          title: 'Receipts by photo',
          status: 'done',
          completedAt: '2026-01-01T00:00:00Z',
        }),
        item({ id: 'live', title: 'Outlook ingestion' }),
      ],
      dependencies: [],
    });
    const narrowed = applyView(closed, 'all');
    const { sections, finished } = splitFinished(narrowed);
    expect(finished.map((node) => node.title)).toEqual(['Share links', 'Receipts by photo']);

    const html = renderToStaticMarkup(
      <PlanView
        sections={sections}
        finished={finished}
        summary={summarize(closed)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
      />,
    );
    // The fold says how many it is holding, so shutting it does not hide the
    // count, and the rows are in it rather than in the module above.
    expect(html).toContain('Finished');
    expect(html).toContain('2</span> features');
    expect(html).toContain('Share links');
    expect(html).toContain('Outlook ingestion');
  });

  it('leaves a module with nothing open off the open view, and keeps it on all', () => {
    // Four of the seven modules have nothing open, so on the working view they
    // are headings between you and the work. The invitation to plan one is on
    // Everything, along with the offer to start the app-wide list.
    const open = render('open');
    expect(open).not.toContain('Vault');
    expect(open).not.toContain('The app as a whole');

    const all = render('all');
    expect(all).toContain('Vault');
    expect(all).toContain('The app as a whole');
  });

  it('puts the facts that decide what is next on the line', () => {
    const html = render('open');
    expect(html).toContain('>Next<');
    expect(html).toContain('>Someday<');
    // Normal is the priority of nearly every step, so drawing it put the same
    // word on almost every row. Next and Someday are what the column is for.
    //
    // Since note 3bfb2749 the word is the control that changes it, so on a
    // Normal step it is in the markup as the thing you click -- and drawn
    // only while the row is under the pointer, which is what keeps the
    // resting column to Next and Someday. The rule is the class now.
    expect(html).toContain('opacity-0 group-hover:opacity-100');
    // Not who has it: the Who column was dropped deliberately -- it was a
    // column of dashes with the occasional "Dash" in it. Who has a step is on
    // the open step, in the "Dash's" view, and in the menu that sets it, and
    // the next two assertions are the ones that cover those.
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
    // A blocked step says who can unblock it, which is the word every dev
    // queue now uses for a row stopped on the person.
    expect(html).toContain('aria-label="Job search: 1 waiting on you"');
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
    // Four of the five open steps: everything but the blocked one, since
    // approving a step is what makes it Dash's and only `stuck` is on you.
    expect(html).toMatch(/>4<\/span> Dash/);
  });

  it('draws five views as chips and leaves the rest to the menu', () => {
    const row = /<nav aria-label="View"[^>]*>([\s\S]*?)<\/nav>/.exec(render('open'))?.[1] ?? '';
    expect(row).not.toBe('');
    expect([...row.matchAll(/<a /g)]).toHaveLength(5);
    for (const label of ['Open', 'Ready', 'On you', 'Dash&#x27;s', 'Everything']) {
      expect(row).toContain(label);
    }
    // The menu holds the other four. Its panel is a portal opened on a press,
    // so the row itself carries only the trigger.
    expect(row).toContain('More views');
    expect(row).not.toContain('Not specified');
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
        finished={[]}
        summary={summarize(nobodys)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={handedToClaude(nobodys).length}
        unfolded
      />,
    );
    expect(html).not.toContain('to Claude</button>');
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
        finished={[]}
        summary={summarize(reshaped)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
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
        finished={[]}
        summary={summarize(nothing)}
        view="ready"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
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
        finished={[]}
        summary={summarize(withDecision)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
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
        finished={[]}
        summary={summarize(withQuestions)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
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
        finished={[]}
        summary={summarize(foggy)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
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

  it('gives a feature that is only fog an arrow to fold it away', () => {
    // #386's shape: real enough to name, not yet real enough to break into
    // steps. The fold used to be drawn off the sub-steps alone, so a row like
    // this one had its fog pinned open with no control anywhere on it.
    const stepless = buildPlanTree({
      items: [
        item({
          id: 'defence',
          title: 'Test each concept at three rungs',
          fog: 'The defence rung still cannot be written as steps.',
        }),
        item({ id: 'plain', title: 'A feature with neither steps nor fog' }),
      ],
      dependencies: [],
    });
    const html = renderToStaticMarkup(
      <PlanView
        sections={applyView(stepless, 'all')}
        finished={[]}
        summary={summarize(stepless)}
        view="all"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
      />,
    );

    // Unfolded to start, so scanning the plan still reads the fog without a
    // press -- the arrow is what is new, not the hiding.
    expect(html).toContain('The defence rung still cannot be written as steps.');
    expect(html).toContain('Fold what is not yet specified');
    // Exactly one control: the row with nothing under it gets no arrow, and
    // the fog row gets one rather than two.
    expect((html.match(/what is not yet specified/g) ?? []).length).toBe(2);
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
          finished={[]}
          summary={summarize(aside)}
          view={view}
          catalog={[]}
          empty={false}
          canSend={false}
          lastRuns={{}}
          commitChecks={{}}
          queued={0}
          unfolded
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
          finished={[]}
          summary={summarize(aside)}
          view={view}
          catalog={[]}
          empty={false}
          canSend={false}
          lastRuns={{}}
          commitChecks={{}}
          queued={0}
          unfolded
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

/**
 * The Status column, which is the whole point of there being two.
 *
 * Health and status had been one word, so the page could not say "a session is
 * on this" and "three of its seven steps are done" at the same time. These
 * assert the page draws both, and that the words come out of the fixture the
 * way the rules say they should.
 */
describe('health and status, as two columns', () => {
  it('heads both columns', () => {
    const html = render('all');
    expect(html).toContain('>Health<');
    expect(html).toContain('>Status<');
  });

  // The complaint the note was filed about: a feature whose first step is done
  // used to go on saying "Not started", with a progress bar beside it saying
  // otherwise on the same line.
  it('calls a feature with a finished step in progress, not not-started', () => {
    const html = render('all');
    // The row's own two cells: the health menu carries the row's name in its
    // label, and the health word and the status word follow it in order.
    const from = html.indexOf('Status of #1 Share links');
    expect(from).toBeGreaterThan(-1);
    const row = html.slice(from, from + 900);
    expect(row).toContain('In progress');
    expect(row).not.toContain('Not started');
  });

  it('says a step handed over is for Dash', () => {
    expect(render('all')).toContain('For Dash');
  });

  it('says a blocked step and a proposal need you', () => {
    const html = render('all');
    expect(html).toContain('Needs you');
  });

  it('says a step nobody has handed anywhere is yours', () => {
    expect(render('all')).toContain('Yours');
  });

  it('says a step held up by another is held up', () => {
    expect(render('all')).toContain('Held up');
  });
});

/**
 * What CI said about a shipped step, on the row.
 *
 * The answer is kept against the commit the step closed at, so the page draws
 * it from a map rather than from the row -- which is exactly the kind of wiring
 * that typechecks and then shows nothing.
 */
describe('the CI mark on a closed step', () => {
  const shipped = buildPlanTree({
    items: [
      item({ id: 'red', title: 'Landed on a red commit', status: 'done', commitSha: 'aaaaaaa' }),
      item({ id: 'green', title: 'Landed on a green commit', status: 'done', commitSha: 'bbbbbbb' }),
      item({ id: 'new', title: 'Nobody has looked yet', status: 'done', commitSha: 'ccccccc' }),
    ],
    dependencies: [],
  });

  const html = renderToStaticMarkup(
    <PlanView
      sections={applyView(shipped, 'all')}
      finished={[]}
      summary={summarize(shipped)}
      view="all"
      catalog={[]}
      empty={false}
      canSend={false}
      lastRuns={{}}
      commitChecks={{
        aaaaaaa: { mergeSha: 'f12facc', conclusion: 'failed', checkedAt: '2026-09-17T03:00:00Z' },
        bbbbbbb: { mergeSha: 'f12facc', conclusion: 'passed', checkedAt: '2026-09-17T03:00:00Z' },
      }}
      queued={0}
      unfolded
    />,
  );

  // From the row's own title up to its status menu, which is the end of the
  // step cell and the start of the next column. Anything else would let the
  // row above lend its mark to the row below.
  const row = (title: string) => {
    const from = html.indexOf(title);
    expect(from).toBeGreaterThan(-1);
    const to = html.indexOf('Status of #', from);
    expect(to).toBeGreaterThan(from);
    return html.slice(from, to);
  };

  it('marks the step that landed on a failing commit', () => {
    expect(row('Landed on a red commit')).toContain('CI failed');
  });

  it('leaves a step whose checks passed unmarked', () => {
    expect(row('Landed on a green commit')).not.toContain('CI failed');
    expect(row('Landed on a green commit')).not.toContain('Not checked');
  });

  it('says so on a step with no answer yet, rather than letting it look green', () => {
    expect(row('Nobody has looked yet')).toContain('Not checked');
  });

  it('names the merge the checks were read from', () => {
    expect(html).toContain('the merge that put this on main');
  });
});

describe('a claim, drawn from what its run did', () => {
  const NOW = Date.parse('2026-09-17T12:00:00Z');
  const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

  /** The page, for one step claimed `minutes` ago with no run recorded. */
  function drawClaim(minutes: number) {
    const items = [
      item({ id: 'a', title: 'Being worked', status: 'in_progress', startedAt: minutesAgo(minutes) }),
    ];
    const liveness = planLiveness(items, {}, NOW);
    const tree = buildPlanTree({ items, dependencies: [] }, liveness);
    return renderToStaticMarkup(
      <PlanView
        sections={applyView(tree, 'open')}
        finished={[]}
        summary={summarize(tree)}
        view="open"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        liveness={liveness}
        commitChecks={{}}
        queued={0}
        unfolded
      />,
    );
  }

  it('draws a fresh claim as work in hand', () => {
    const html = drawClaim(10);
    expect(html).toContain('In progress');
    expect(html).not.toContain('Stopped');
  });

  it('draws a claim whose run ended as stopped, and counts it that way too', () => {
    // The whole of #500 on one row: the column, the pill and the count beside
    // the module heading all read the claim through the same function, so the
    // page cannot say underway while the count says the run is gone.
    const html = drawClaim(200);
    expect(html).toContain('Stopped');
    expect(html).toContain('stopped without closing');
  });
});

describe('what an opened step says its run has done', () => {
  const NOW = Date.parse('2026-09-17T12:00:00Z');
  const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
  const FIRED = minutesAgo(40);

  /** One claimed feature with a closed step under it, and the run that did it. */
  function drawRun(
    reading: LastRun['reading'],
    raises: (childNumber: number) => RunRaise[] = () => [],
    childClosedAt: string | null = minutesAgo(8),
  ) {
    const parent = item({
      id: 'p',
      title: 'Being worked',
      status: 'in_progress',
      startedAt: FIRED,
    });
    const child = item({
      id: 'c',
      title: 'Already closed',
      parentId: 'p',
      status: childClosedAt ? 'done' : 'not_started',
      completedAt: childClosedAt,
    });
    const items = [parent, child];
    const lastRuns: Record<string, LastRun> = {
      p: { status: 'started', createdAt: FIRED, error: null, job: 'feature', reading },
    };
    const liveness = planLiveness(items, lastRuns, NOW);
    const tree = buildPlanTree({ items, dependencies: [] }, liveness);
    return renderToStaticMarkup(
      <PlanView
        sections={applyView(tree, 'open')}
        finished={[]}
        summary={summarize(tree)}
        view="open"
        catalog={catalogOf(tree)}
        empty={false}
        canSend={false}
        lastRuns={lastRuns}
        runRaises={raises(child.number)}
        liveness={liveness}
        commitChecks={{}}
        queued={0}
        unfolded
        opened
      />,
    );
  }

  it('names the run and when it started, not only that something is underway', () => {
    const html = drawRun(null);
    expect(html).toContain('Its run');
    expect(html).toContain(`A feature batch started ${FIRED.replace('T', ' ').slice(0, 16)}`);
  });

  it('lists what it pushed, what it closed and what it raised', () => {
    const html = drawRun(
      {
        checkedAt: minutesAgo(1),
        lastPush: { at: minutesAgo(6), sha: 'f04d9da1111', subject: 'Read a claim (plan #500)' },
        refusal: null,
      },
      (child) => [
        {
          id: 'r',
          title: 'The GitHub key is refused',
          source: `plan #${child}`,
          createdAt: minutesAgo(10),
        },
      ],
    );
    expect(html).toContain('Read a claim (plan #500)');
    expect(html).toContain('Closed #');
    expect(html).toContain('The GitHub key is refused');
  });

  it('says a run with nothing to show has nothing to show, and which kind of nothing', () => {
    // No stored reading at all: nobody has asked GitHub, which is not the same
    // fact as a run that was asked about and had pushed nothing.
    const html = drawRun(null, () => [], null);
    expect(html).toContain('nothing has asked GitHub what it has pushed');
  });

  it('prints why GitHub refused, on a run that closed a step all the same', () => {
    // #566. The run has a closure to report, so it is not empty and the
    // sentence about nothing to show never renders -- the rejected key was
    // invisible on exactly the runs doing work. It is printed as GitHub's
    // refusal was worded, since that sentence names the variable and says
    // what to do about it.
    const html = drawRun({
      checkedAt: minutesAgo(1),
      lastPush: null,
      refusal:
        'GITHUB_READ_TOKEN is missing a permission (403). Give it access to ' +
        "knightx4/PersonalDashboard in the token's settings, then redeploy.",
    });
    expect(html).toContain('Closed #');
    expect(html).toContain('GITHUB_READ_TOKEN is missing a permission (403)');
    expect(html).toContain('then redeploy.');
  });
});

/**
 * The refused key, above the whole plan.
 *
 * Its own state and not a run's: the key is one setting, so every claimed row
 * below is being read off the clock for the same reason, and the page says
 * that once rather than on each row.
 */
describe('what the page says when GitHub refuses the key', () => {
  const NOW = Date.parse('2026-09-17T12:00:00Z');
  const REJECTED =
    'GITHUB_READ_TOKEN was rejected by GitHub (401) — it has expired or is mistyped.';

  function draw(keyRefusal: string | null) {
    const items = [item({ id: 'a', title: 'Being worked', status: 'in_progress' })];
    const liveness = planLiveness(items, {}, NOW);
    const tree = buildPlanTree({ items, dependencies: [] }, liveness);
    return renderToStaticMarkup(
      <PlanView
        sections={applyView(tree, 'open')}
        finished={[]}
        summary={summarize(tree)}
        view="open"
        catalog={[]}
        empty={false}
        canSend={false}
        lastRuns={{}}
        keyRefusal={keyRefusal}
        liveness={liveness}
        commitChecks={{}}
        queued={0}
      />,
    );
  }

  it('says so once, in the words the refusal was recorded in', () => {
    const html = draw(REJECTED);
    expect(html).toContain('Nothing can read what these runs have pushed.');
    expect(html).toContain(REJECTED);
    // And what the rows are doing in the meantime, since they go on showing a
    // reading and it is no longer coming from GitHub.
    expect(html).toContain('reads off the clock');
  });

  it('says nothing at all when the key is working', () => {
    const html = draw(null);
    expect(html).not.toContain('Nothing can read what these runs have pushed.');
    expect(html).not.toContain('GITHUB_READ_TOKEN');
  });
});

/**
 * #598: a setup job is a row on the plan like any other, and the one thing you
 * can do to it is say you have done it.
 */
describe('a setup step on the plan', () => {
  function drawSetup(status: PlanItem['status'] = 'not_started') {
    const feature = item({ id: 'f', title: 'Send the weekly digest', module: 'dev' });
    const job = item({
      id: 's',
      title: 'Put the Resend API key in Vercel',
      parentId: 'f',
      module: 'dev',
      kind: 'setup',
      status,
      detail: 'Make a key at resend.com, then add RESEND_API_KEY to the Vercel project.',
    });
    const tree = buildPlanTree({ items: [feature, job], dependencies: [] });
    return renderToStaticMarkup(
      <PlanView
        sections={applyView(tree, 'all')}
        finished={[]}
        summary={summarize(tree)}
        view="all"
        catalog={catalogOf(tree)}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        queued={0}
        unfolded
        opened
      />,
    );
  }

  it('shows what to set and the press that closes it, under its own feature', () => {
    const html = drawSetup();

    // Under the feature it belongs to, as an ordinary row in the tree.
    expect(html).toContain('Send the weekly digest');
    expect(html).toContain('Put the Resend API key in Vercel');
    // What to actually go and do, labelled rather than left as a paragraph.
    expect(html).toContain('What to set up');
    expect(html).toContain('add RESEND_API_KEY to the Vercel project');
    // One press, and it says no commit is recorded against it.
    expect(html).toContain('I have set this up');
    expect(html).toContain('This closes the step. Nothing is committed against it.');
    // Its own health, not a blocked build's.
    expect(html).toContain('Setup');
  });

  it('says the detail once, not once in the box and once above it', () => {
    const html = drawSetup();
    const detail = 'Make a key at resend.com';
    expect(html.split(detail)).toHaveLength(2);
  });

  it('offers nothing to press once the errand has been run', () => {
    const html = drawSetup('done');
    expect(html).not.toContain('I have set this up');
    expect(html).not.toContain('What to set up');
    // The detail comes back as an ordinary step's does.
    expect(html).toContain('Make a key at resend.com');
  });
});
