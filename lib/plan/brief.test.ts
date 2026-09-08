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
});
