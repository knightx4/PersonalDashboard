import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import {
  commentRunText,
  goalContext,
  goalReplyMessage,
  parseGoalReply,
  replyBody,
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
    records: [{ data: { servicer: 'Nelnet', balance: 8000, rate: 5.5 }, draft: false }],
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
      fog: null,
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
    expect(text).toContain('- Servicer Nelnet; Balance $8,000.00; Rate 5.5%');
    expect(text).toContain('### c2: Income');
    expect(text).toContain('Holds a single record.');
    expect(refs.collections.get('c1')?.id).toBe('col-loans');
    expect(refs.collections.get('c2')?.id).toBe('col-profile');
  });

  it('puts the thread and the comment after the goal', () => {
    const { message } = goalReplyMessage(
      context(),
      [{ id: 'c1', author: 'me', body: 'How many loans?', createdAt: '2026-09-24T10:00:00Z' }],
      'The Navient one is 12,450 at 6.8%',
    );
    expect(message.indexOf('# A goal')).toBeLessThan(message.indexOf('The person: How many loans?'));
    expect(message.trimEnd().endsWith('The Navient one is 12,450 at 6.8%')).toBe(true);
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
    });
  });

  it('reads filings by collection ref, dropping unknown refs and empty values', () => {
    const reply = parseGoalReply(
      {
        answer: null,
        needs_routine: false,
        file: [
          { collection: 'c1', values: { servicer: 'Navient', balance: 12450, rate: 6.8, old: null } },
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
    expect(reply.filings[0].values).toEqual({ servicer: 'Navient', balance: 12450, rate: 6.8 });
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
      { ok: true, collection: loans, data: { servicer: 'Navient', balance: 12450, rate: 6.8 } },
    ]);
    expect(body).toBe(
      'Filed into Loans as a draft: Servicer Navient, Balance $12,450.00, Rate 6.8%. Confirm it on the step.',
    );
  });

  it('lists several, and says what was refused and why', () => {
    const body = replyBody('Got them.', [
      { ok: true, collection: loans, data: { servicer: 'Navient' } },
      { ok: true, collection: loans, data: { servicer: 'Nelnet' } },
      { ok: false, collection: loans, error: 'Rate must be a number.' },
    ]);
    expect(body).toContain('Got them.');
    expect(body).toContain('Filed 2 records as drafts. Confirm them on the step:');
    expect(body).toContain('- Loans: Servicer Nelnet');
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
      question: 'Find my Navient statement in Gmail',
      why: 'Needs email.',
    });
    expect(text.startsWith('Work on one goal')).toBe(true);
    expect(text).toContain('the step "List each loan"');
    expect(text).toContain('Claude: Which servicer?');
    expect(text).toContain('Find my Navient statement in Gmail');
    expect(text).toContain(
      "insert into goals.comments (user_id, item_id, author, body) values ('user-1', 'step-2', 'claude', '<your reply>');",
    );
  });
});
