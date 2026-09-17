import { describe, expect, it } from 'vitest';
import { dismissedUnder, planBrief, planQueueBrief } from '@/lib/plan/brief';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import { buildPlanTree, findNode, handedToClaude } from '@/lib/plan/tree';

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
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

function dep(itemId: string, dependsOnId: string): PlanDependency {
  return { id: `${itemId}->${dependsOnId}`, itemId, dependsOnId };
}

describe('planBrief', () => {
  const sections = buildPlanTree({
    items: [
      item({ id: 'schema', title: 'Schema', status: 'done', commitSha: 'abc1234' }),
      item({ id: 'feature', title: 'Share links', priority: 1, size: 'l' }),
      item({
        id: 'page',
        title: 'The anonymous page',
        parentId: 'feature',
        detail: 'A page a person with no account can open.',
        acceptance: 'Opens without a session. Shows only owned items.',
        comment: 'Waiting on the RPC review.',
        assignee: 'claude',
        size: 'm',
      }),
      item({ id: 'form', title: 'The form', parentId: 'page' }),
      item({ id: 'done-form', title: 'The finished bit', parentId: 'page', status: 'done' }),
      item({ id: 'later', title: 'Analytics on responses', parentId: 'feature' }),
      item({ id: 'rpc', title: 'The read RPC', status: 'in_progress' }),
      item({ id: 'auth', title: 'Anonymous auth' }),
    ],
    dependencies: [
      dep('feature', 'schema'),
      dep('feature', 'auth'),
      dep('page', 'rpc'),
      dep('later', 'page'),
    ],
  });

  const brief = planBrief(sections, findNode(sections, 'page')!);

  it('opens with the handle and the title', () => {
    expect(brief.startsWith('# Plan step #3 — The anonymous page\n')).toBe(true);
  });

  it('says where the step sits and who holds it', () => {
    expect(brief).toContain('Module: Shopping');
    expect(brief).toContain('Assigned: Claude');
    expect(brief).toContain('Size: M');
    expect(brief).toContain('Part of: #2 Share links');
  });

  it('carries what it involves and what done means', () => {
    expect(brief).toContain('## What it involves\n\nA page a person with no account can open.');
    expect(brief).toContain('## Done when\n\nOpens without a session. Shows only owned items.');
  });

  it('names its own waits, and the ones it inherits, separately', () => {
    expect(brief).toContain('## Waits on\n\n- #7 The read RPC (still open)');
    // Schema is done, so only the open one is still holding it up.
    expect(brief).toContain('Also held up, through a step above it, by:\n\n- #8 Anonymous auth');
    expect(brief).not.toContain('- #1 Schema');
  });

  it('lists the steps beneath it as a checklist', () => {
    expect(brief).toContain('## Steps\n\n- [ ] #4 The form\n- [x] #5 The finished bit');
  });

  it('says what finishing it would unblock, and carries the note', () => {
    expect(brief).toContain('## Unblocks\n\n- #6 Analytics on responses');
    expect(brief).toContain('## Notes\n\nWaiting on the RPC review.');
  });

  it('leaves out every section it has nothing to say in', () => {
    const bare = planBrief(sections, findNode(sections, 'form')!);
    expect(bare).not.toContain('## What it involves');
    expect(bare).not.toContain('## Done when');
    expect(bare).not.toContain('## Waits on');
    expect(bare).not.toContain('## Steps');
    expect(bare).not.toContain('## Notes');
    expect(bare).toContain('Part of: #2 Share links › #3 The anonymous page');
  });

  it('records the commit on a step that shipped', () => {
    expect(planBrief(sections, findNode(sections, 'schema')!)).toContain('Shipped in abc1234.');
  });

  it('carries the feature it belongs to as the destination', () => {
    // Its own done-when says what this step is for; the destination says what
    // the whole feature is for, which is what it has to not miss.
    const bare = planBrief(sections, findNode(sections, 'form')!);
    expect(bare).toContain(
      '## Destination\n\n#3 The anonymous page — Opens without a session. Shows only owned items.',
    );
  });

  it('gives a step with no feature above it, no decisions and no fog exactly the brief it had', () => {
    // The one that must not grow: an ordinary step in an ordinary plan.
    const plain = planBrief(sections, findNode(sections, 'auth')!);
    expect(plain).not.toContain('## Destination');
    expect(plain).not.toContain('## Decided so far');
    expect(plain).not.toContain('## Not yet specified');
    expect(plain).not.toContain('## Question');
    expect(plain).toBe(
      '# Plan step #8 — Anonymous auth\n\n' +
        'Module: Shopping · Status: not started · Priority: normal\n\n' +
        '## Unblocks\n\n- #2 Share links\n',
    );
  });
});

describe('planBrief with decisions and fog', () => {
  const sections = buildPlanTree({
    items: [
      item({
        id: 'feature',
        title: 'Export',
        acceptance: 'I can take my data out.',
        fog: 'What the second half looks like is not yet known.',
      }),
      item({
        id: 'settled',
        title: 'One file or many?',
        parentId: 'feature',
        kind: 'decision',
        status: 'done',
        resolution: 'One file per month.',
      }),
      item({
        id: 'withdrawn',
        title: 'Do we compress it?',
        parentId: 'feature',
        kind: 'decision',
        status: 'dropped',
        resolution: 'n/a',
      }),
      item({
        id: 'open-question',
        title: 'CSV or JSON?',
        parentId: 'feature',
        kind: 'decision',
        detail: 'CSV opens in a spreadsheet; JSON keeps the nesting. Recommend CSV.',
      }),
      item({ id: 'writer', title: 'The writer', parentId: 'feature' }),
    ],
    dependencies: [],
  });

  it('carries every decision already settled beneath the feature, with its answer', () => {
    const brief = planBrief(sections, findNode(sections, 'writer')!);
    expect(brief).toContain('## Decided so far\n\n- #10 One file or many? — One file per month.');
  });

  it('leaves out a decision that was withdrawn rather than answered', () => {
    const brief = planBrief(sections, findNode(sections, 'writer')!);
    expect(brief).not.toContain('Do we compress it?');
  });

  it('leads a decision with the question rather than the work', () => {
    const brief = planBrief(sections, findNode(sections, 'open-question')!);
    expect(brief).toContain('## Question\n\nCSV opens in a spreadsheet');
    expect(brief).not.toContain('## What it involves');
  });

  it('does not tell a decision its own answer back', () => {
    const brief = planBrief(sections, findNode(sections, 'settled')!);
    expect(brief).not.toContain('## Decided so far');
    expect(brief).toContain('## Answered\n\nOne file per month.');
  });

  it('says what is not yet specified when a step admits it', () => {
    const brief = planBrief(sections, findNode(sections, 'feature')!);
    expect(brief).toContain(
      '## Not yet specified\n\nWhat the second half looks like is not yet known.',
    );
    // The feature's own done-when is already printed; it is not its own destination.
    expect(brief).not.toContain('## Destination');
  });
});

describe('planQueueBrief', () => {
  // The numbers below are asserted literally, and `counter` is shared with the
  // describes above.
  counter = 0;

  const sections = buildPlanTree({
    items: [
      item({ id: 'rpc', title: 'The read RPC', priority: 1, assignee: 'claude' }),
      item({
        id: 'page',
        title: 'The anonymous page',
        detail: 'A page a person with no account can open.',
        assignee: 'claude',
      }),
      item({ id: 'later', title: 'Analytics on responses', priority: 3, assignee: 'claude' }),
    ],
    dependencies: [dep('page', 'rpc')],
  });

  const queue = handedToClaude(sections);
  const brief = planQueueBrief(sections, queue);

  it('opens with the running order as a numbered list', () => {
    expect(brief.startsWith('# 3 plan steps, in order\n')).toBe(true);
    expect(brief).toContain('1. #1 The read RPC — Shopping · next');
    expect(brief).toContain('2. #2 The anonymous page — Shopping · normal · waits on #1');
    expect(brief).toContain('3. #3 Analytics on responses — Shopping · someday');
  });

  it('carries every step whole, not just its name', () => {
    expect(brief).toContain('# Plan step #2 — The anonymous page');
    expect(brief).toContain('## What it involves\n\nA page a person with no account can open.');
    expect(brief.match(/^# Plan step /gm)).toHaveLength(3);
  });

  it('counts one step as a step', () => {
    expect(planQueueBrief(sections, [queue[0]]).startsWith('# 1 plan step, in order\n')).toBe(true);
  });
});

describe('planBrief on a step a re-shape wrote', () => {
  it('names the answer that produced it, at the top rather than in the notes', () => {
    const sections = buildPlanTree({
      items: [
        item({ id: 'f', title: 'Re-shaping' }),
        item({
          id: 'added',
          title: 'The graduated step',
          parentId: 'f',
          status: 'proposed',
          comment: "From #63's answer: On the server, not the client.",
        }),
      ],
      dependencies: [],
    });
    const node = findNode(sections, 'added')!;
    const brief = planBrief(sections, node);

    expect(brief).toContain("From #63's answer: On the server, not the client.");
    // Above the notes, which is where it would otherwise be buried.
    expect(brief.indexOf("From #63's answer")).toBeLessThan(brief.indexOf('## Notes'));
  });
});


describe('what has been put aside', () => {
  const sections = buildPlanTree({
    items: [
      item({
        id: 'feature',
        title: 'Talking back',
        acceptance: 'I can answer a session without leaving the app.',
        fog: 'how a reply reaches a decision is not settled',
        fogDismissedAt: '2026-09-13T00:00:00Z',
      }),
      item({
        id: 'asked',
        title: 'Which shape for the reply?',
        parentId: 'feature',
        kind: 'decision',
        dismissedAt: '2026-09-13T00:00:00Z',
      }),
      item({ id: 'step', title: 'The thread itself', parentId: 'feature' }),
    ],
    dependencies: [],
  });
  const feature = findNode(sections, 'feature')!;

  it('is left out of the brief a session builds from', () => {
    const brief = planBrief(sections, feature);
    expect(brief).not.toContain('Which shape for the reply?');
    expect(brief).not.toContain('## Not yet specified');
    expect(brief).toContain('The thread itself');
  });

  it('is named for the re-shape, so it is not written back', () => {
    const written = dismissedUnder(feature, [{ body: 'A search box over the whole plan' }]);
    expect(written).toContain('Which shape for the reply?');
    expect(written).toContain('how a reply reaches a decision is not settled');
    expect(written).toContain('A search box over the whole plan');
  });

  it('says nothing at all when nothing has been put aside', () => {
    const clean = buildPlanTree({
      items: [item({ id: 'plain', title: 'A feature with nothing put aside' })],
      dependencies: [],
    });
    expect(dismissedUnder(findNode(clean, 'plain')!)).toBe('');
  });
});

describe('the comments a hand-over carries', () => {
  // The numbers below are asserted literally.
  counter = 0;

  function said(id: string, author: 'me' | 'claude', body: string, at: string) {
    return { id, author, body, createdAt: `2026-02-01T0${at}:00:00Z` };
  }

  const sections = buildPlanTree({
    items: [
      item({
        id: 'feature',
        title: 'Share links',
        acceptance: 'A link opens without an account.',
        thread: [
          said('c1', 'me', 'Keep the whole thing behind one token.', '1'),
          said('c2', 'claude', 'Then the token is what the RLS policy reads.', '2'),
        ],
      }),
      item({
        id: 'page',
        title: 'The anonymous page',
        parentId: 'feature',
        comment: 'Waiting on the RPC review.',
        thread: [said('c3', 'me', 'No prices on this one.', '3')],
      }),
      item({ id: 'form', title: 'The form', parentId: 'feature' }),
      item({
        id: 'aside',
        title: 'A question put aside',
        parentId: 'feature',
        kind: 'decision',
        dismissedAt: '2026-02-02T00:00:00Z',
        thread: [said('c4', 'me', 'Not now.', '4')],
      }),
    ],
    dependencies: [],
  });

  const feature = findNode(sections, 'feature')!;
  const page = findNode(sections, 'page')!;

  it('says nothing about them unless the hand-over asks', () => {
    expect(planBrief(sections, feature)).not.toContain('## Comments');
    expect(planBrief(sections, page)).toBe(planBrief(sections, page, {}));
  });

  it('carries the comments on the step, oldest first and marked', () => {
    const brief = planBrief(sections, page, { thread: true });
    expect(brief).toContain('## Comments\n\nLeft on these rows, oldest first.');
    expect(brief).toContain('On #2 The anonymous page:\n\n- The person: No prices on this one.');
  });

  it('carries the comments on the steps beneath it as well, grouped by row', () => {
    const brief = planBrief(sections, feature, { thread: true });
    expect(brief).toContain(
      'On #1 Share links:\n\n- The person: Keep the whole thing behind one token.\n' +
        '- Claude: Then the token is what the RLS policy reads.',
    );
    expect(brief).toContain('On #2 The anonymous page:\n\n- The person: No prices on this one.');
  });

  it('leaves out what has been put aside, the same as the checklist', () => {
    expect(planBrief(sections, feature, { thread: true })).not.toContain('Not now.');
  });

  it('gives a step nobody has commented on the brief it had', () => {
    const form = findNode(sections, 'form')!;
    expect(planBrief(sections, form, { thread: true })).toBe(planBrief(sections, form));
  });

  it('puts them after the notes', () => {
    const brief = planBrief(sections, page, { thread: true });
    expect(brief.indexOf('## Comments')).toBeGreaterThan(brief.indexOf('## Notes'));
  });

  it('carries them through a queue as well', () => {
    const queue = [page, feature];
    expect(planQueueBrief(sections, queue, { thread: true })).toContain(
      '- The person: No prices on this one.',
    );
    expect(planQueueBrief(sections, queue)).not.toContain('## Comments');
  });
});
