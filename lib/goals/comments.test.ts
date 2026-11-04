import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import {
  commentRunText,
  goalContext,
  goalReplyMessage,
  parseGoalReply,
  replyBody,
  resolveGoalTarget,
  type GoalReplyContext,
  type ReplyCollection,
} from '@/lib/goals/comments';
import type { StepNode } from '@/lib/goals/steps';

const loanFields: CollectionField[] = [
  { key: 'servicer', label: 'Servicer', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'old', label: 'Old', type: 'text', removed: true },
];

function step(id: string, title: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'goal-1',
    kind: 'mine',
    status: 'open',
    title,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    children: [],
    ...extra,
  };
}

function context(itemId = 'step-2'): GoalReplyContext {
  const loans: ReplyCollection = {
    id: 'col-loans',
    name: 'Loans',
    shape: 'list',
    fields: loanFields,
    records: [{ data: { servicer: 'Northstar', balance: 8000, rate: 5.5 }, draft: false }],
  };
  const profile: ReplyCollection = {
    id: 'col-profile',
    name: 'Income',
    shape: 'one',
    fields: [{ key: 'salary', label: 'Salary', type: 'money' }],
    records: [],
  };
  return {
    goal: {
      id: 'goal-1',
      areaId: 'area-1',
      title: 'Pay off student debt',
      acceptance: 'Every loan at zero',
      status: 'open',
      position: 10,
      unit: '$',
      target: 0,
    },
    steps: [
      step('step-1', 'Get the numbers', {
        acceptance: 'Every loan listed',
        children: [step('step-2', 'List each loan', { parentId: 'step-1' })],
      }),
      step('step-3', 'Avalanche or snowball?', { kind: 'decision', resolution: 'A — Avalanche' }),
    ],
    collections: [loans, profile],
    itemId,
  };
}

describe('the goal written out for a reply', () => {
  it('names the goal, marks the step the comment is on, and lists steps as a tree', () => {
    const { text } = goalContext(context());
    expect(text).toContain('# A goal: Pay off student debt');
    expect(text).toContain('Done when: Every loan at zero');
    expect(text).toContain('The comment is on the step "List each loan"');
    expect(text).toContain('- Get the numbers (Yours, open)');
    expect(text).toContain('  - List each loan (Yours, open) ← the comment is on this step');
    expect(text).toContain('Answered: A — Avalanche');
  });

  it('says when the comment is on the goal itself', () => {
    expect(goalContext(context('goal-1')).text).toContain('The comment is on the goal itself.');
  });

  it('lists each collection under a ref with its live fields and what is filled in', () => {
    const { text, refs } = goalContext(context());
    expect(text).toContain('### c1: Loans');
    expect(text).toContain('- balance: Balance, money, an amount as a plain number, 12450.37.');
    expect(text).not.toContain('- old:');
    expect(text).toContain('- Servicer Northstar; Balance $8,000.00; Rate 5.5%');
    expect(text).toContain('### c2: Income');
    expect(text).toContain('Holds a single record.');
    expect(refs.collections.get('c1')?.id).toBe('col-loans');
    expect(refs.collections.get('c2')?.id).toBe('col-profile');
  });

  it('lists their other open goals under refs a move names', () => {
    const { text, refs } = goalContext({
      ...context(),
      otherGoals: [
        { id: 'g-house', title: 'Buy a house', areaName: 'Home', errand: false },
        { id: 'g-dmv', title: 'Renew the licence', areaName: 'Admin', errand: true },
      ],
    });
    expect(text).toContain('## Their other open goals');
    expect(text).toContain('- g1: Buy a house (a goal in Home)');
    expect(text).toContain('- g2: Renew the licence (an errand in Admin)');
    expect(refs.goals.get('g2')?.id).toBe('g-dmv');
    expect(goalContext(context()).text).toContain('None, so there is no other goal to move a step under.');
  });

  it('puts the thread and the comment after the goal', () => {
    const { message } = goalReplyMessage(
      context(),
      [{ id: 'c1', author: 'me', body: 'How many loans?', createdAt: '2026-09-24T10:00:00Z' }],
      'The Brightline one is 12,450 at 6.8%',
    );
    expect(message.indexOf('# A goal')).toBeLessThan(message.indexOf('The person: How many loans?'));
    expect(message.trimEnd().endsWith('The Brightline one is 12,450 at 6.8%')).toBe(true);
  });
});

describe('the goal a move names (plan #2035.1)', () => {
  const goals = new Map([
    ['g1', { id: 'a', title: 'Buy a house', areaName: 'Home', errand: false }],
    ['g2', { id: 'b', title: 'Fix up the house', areaName: 'Home', errand: false }],
    ['g3', { id: 'c', title: 'Run a half marathon', areaName: 'Health', errand: false }],
  ]);

  it('takes the ref when the words fit it, or fit no title at all', () => {
    expect(resolveGoalTarget(goals, 'g3', 'the half marathon')).toMatchObject({ ok: true, goal: { id: 'c' } });
    expect(resolveGoalTarget(goals, 'g1', 'Buy a house!')).toMatchObject({ ok: true, goal: { id: 'a' } });
    expect(resolveGoalTarget(goals, 'g3', 'running')).toMatchObject({ ok: true, goal: { id: 'c' } });
  });

  it('refuses an unknown ref, words that fit two goals, and words that fit another goal', () => {
    expect(resolveGoalTarget(goals, 'g9', 'house')).toMatchObject({ ok: false });
    const two = resolveGoalTarget(goals, 'g1', 'house');
    expect(two).toEqual({
      ok: false,
      error: '"house" could be "Buy a house" or "Fix up the house", so nothing was moved. Ask them which one they mean.',
    });
    expect(resolveGoalTarget(goals, 'g1', 'the house goal')).toMatchObject({ ok: false });
    expect(resolveGoalTarget(goals, 'g1', 'fix up the house')).toMatchObject({ ok: false });
    expect(resolveGoalTarget(goals, 'g2', 'fix up the house')).toMatchObject({ ok: true, goal: { id: 'b' } });
  });
});

describe('reading the reply', () => {
  const { refs } = goalContext(context());

  it('takes the step when asked to, over anything else in the answer (plan #1003)', () => {
    expect(
      parseGoalReply({ answer: 'Sure.', needs_routine: true, send_step: true }, refs),
    ).toEqual({ kind: 'send' });
    expect(parseGoalReply({ answer: 'Sure.', needs_routine: false, send_step: false }, refs).kind).toBe(
      'answer',
    );
  });

  it('reads an answer', () => {
    expect(parseGoalReply({ answer: ' Avalanche saves more. ', needs_routine: false }, refs)).toEqual({
      kind: 'answer',
      body: 'Avalanche saves more.',
      filings: [],
      schedule: null,
    });
  });

  it('reads a date and Todo change, dropping a malformed date', () => {
    const read = (schedule: unknown) =>
      parseGoalReply({ needs_routine: false, schedule }, refs);
    expect(read({ due_on: '2026-10-04', on_todo: true })).toMatchObject({
      schedule: { dueOn: '2026-10-04', onTodo: true },
    });
    expect(read({ due_on: null })).toMatchObject({ schedule: { dueOn: null } });
    expect(read({ due_on: 'October 4th' }).kind).toBe('error');
  });

  it('reads filings by collection ref, dropping unknown refs and empty values', () => {
    const reply = parseGoalReply(
      {
        answer: null,
        needs_routine: false,
        file: [
          { collection: 'c1', values: { servicer: 'Brightline', balance: 12450, rate: 6.8, old: null } },
          { collection: 'c9', values: { balance: 1 } },
          { collection: 'c1', values: { servicer: '' } },
        ],
      },
      refs,
    );
    expect(reply.kind).toBe('answer');
    if (reply.kind !== 'answer') return;
    expect(reply.body).toBe('');
    expect(reply.filings).toHaveLength(1);
    expect(reply.filings[0].collection.id).toBe('col-loans');
    expect(reply.filings[0].values).toEqual({ servicer: 'Brightline', balance: 12450, rate: 6.8 });
  });

  it('passes to the routine whenever it says so, ignoring an answer beside it', () => {
    expect(
      parseGoalReply({ answer: 'a guess', needs_routine: true, why: 'Needs a web search.' }, refs),
    ).toEqual({ kind: 'routine', why: 'Needs a web search.' });
  });

  it('is an error when nothing usable came back', () => {
    expect(parseGoalReply({ needs_routine: false }, refs).kind).toBe('error');
    expect(parseGoalReply(null, refs).kind).toBe('error');
  });
});

describe('what the reply says it filed', () => {
  const loans = context().collections[0];

  it('names one filed record in its stored form and where to confirm it', () => {
    const body = replyBody('', [
      { ok: true, collection: loans, data: { servicer: 'Brightline', balance: 12450, rate: 6.8 } },
    ]);
    expect(body).toBe(
      'Filed into Loans as a draft: Servicer Brightline, Balance $12,450.00, Rate 6.8%. Confirm it on the step.',
    );
  });

  it('lists several, and says what was refused and why', () => {
    const body = replyBody('Got them.', [
      { ok: true, collection: loans, data: { servicer: 'Brightline' } },
      { ok: true, collection: loans, data: { servicer: 'Northstar' } },
      { ok: false, collection: loans, error: 'Rate must be a number.' },
    ]);
    expect(body).toContain('Got them.');
    expect(body).toContain('Filed 2 records as drafts. Confirm them on the step:');
    expect(body).toContain('- Loans: Servicer Northstar');
    expect(body).toContain('Not filed into Loans: Rate must be a number.');
  });
});

describe('the brief for the goals routine', () => {
  it('carries the run text, the comment, the thread and where the reply goes', () => {
    const text = commentRunText({
      runText: 'Work on one goal: "Pay off student debt".',
      userId: 'user-1',
      itemId: 'step-2',
      itemTitle: 'List each loan',
      onGoal: false,
      thread: [{ id: 'x', author: 'claude', body: 'Which servicer?', createdAt: '' }],
      question: 'Find my Brightline statement in Gmail',
      why: 'Needs email.',
    });
    expect(text.startsWith('Work on one goal')).toBe(true);
    expect(text).toContain('the step "List each loan"');
    expect(text).toContain('Claude: Which servicer?');
    expect(text).toContain('Find my Brightline statement in Gmail');
    expect(text).toContain(
      "select core.add_thread_turn('user-1', 'goals.items:step-2', 'claude', '<your reply>');",
    );
  });
});
