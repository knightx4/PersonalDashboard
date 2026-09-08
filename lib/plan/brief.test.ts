import { describe, expect, it } from 'vitest';
import { planBrief } from '@/lib/plan/brief';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import { buildPlanTree, findNode } from '@/lib/plan/tree';

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
