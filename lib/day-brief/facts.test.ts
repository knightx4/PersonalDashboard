import { describe, expect, it } from 'vitest';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import type { AgendaItem, DayContext } from '@/lib/todo/agenda/sources';
import type { Task } from '@/lib/todo/tasks/model';
import type { DailyGoal, WaitingItem } from '@/lib/goals/daily';
import type { Goal } from '@/lib/goals/tree';
import {
  agendaCandidates,
  agendaFacts,
  briefDay,
  candidatesSince,
  chargeCandidates,
  collectCandidates,
  dashResultCandidates,
  replyCandidates,
  waitedOnStep,
  type Candidate,
  type ChargeCandidateRow,
  type GoalCandidateItem,
  goalFact,
  learnFact,
  newsFact,
  PER_KIND,
} from './facts';

const ZONE = 'America/New_York';
const TODAY = '2026-09-28'; // a Monday

function task(title: string, dueOn: string | null = null): AgendaEntry {
  const t: Task = {
    id: title,
    title,
    body: null,
    status: 'open',
    dueOn,
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    position: null,
    parentId: null,
  };
  return { kind: 'task', key: title, task: t, children: [], openChildren: 0, totalChildren: 0 };
}

function item(title: string, day: string, source: AgendaItem['source'] = 'return_deadlines'): AgendaEntry {
  const i: AgendaItem = {
    key: `${source}:${title}`,
    source,
    ref: `public.orders:${title}`,
    title,
    day,
    at: null,
    link: null,
    action: null,
    detail: null,
    completable: false,
  };
  return { kind: 'item', key: i.key, item: i, children: [], openChildren: 0, totalChildren: 0 };
}

function booked(label: string, at: string | null, detail: string | null = null): DayContext {
  return { key: label, ref: `todo.appointments:${label}`, day: TODAY, at, label, detail, link: null };
}

describe('briefDay', () => {
  it('names the local day from six in the morning until the end of the window', () => {
    // 10:05 UTC is 06:05 in New York.
    expect(briefDay(ZONE, new Date('2026-09-28T10:05:00Z'))).toBe('2026-09-28');
    expect(briefDay(ZONE, new Date('2026-09-28T15:59:00Z'))).toBe('2026-09-28');
  });

  it('is null before six and after the window, in the reader zone rather than UTC', () => {
    // 09:59 UTC is 05:59 in New York, though it is already morning in London.
    expect(briefDay(ZONE, new Date('2026-09-28T09:59:00Z'))).toBeNull();
    expect(briefDay('Europe/London', new Date('2026-09-28T09:59:00Z'))).toBe('2026-09-28');
    expect(briefDay(ZONE, new Date('2026-09-28T16:05:00Z'))).toBeNull();
  });
});

describe('agendaFacts', () => {
  it('puts what is booked today first, earliest first, with its time in the reader zone', () => {
    const piles: AgendaPile[] = [
      {
        bucket: 'today',
        entries: [],
        context: [
          booked('Dentist', '2026-09-28T19:00:00Z'),
          booked('Interview with Acme', '2026-09-28T13:30:00Z', 'Round 2'),
          booked('Office closed', null),
        ],
      },
    ];
    expect(agendaFacts(piles, TODAY, ZONE)).toEqual([
      { kind: 'booked', text: 'All day: Office closed' },
      { kind: 'booked', text: '9:30\u00a0AM: Interview with Acme (Round 2)' },
      { kind: 'booked', text: '3:00\u00a0PM: Dentist' },
    ]);
  });

  it('keeps overdue and today entries, and only source items closing within the week', () => {
    const piles: AgendaPile[] = [
      { bucket: 'overdue', entries: [task('Renew passport', '2026-09-20')], context: [] },
      { bucket: 'today', entries: [item('Return window closes, Boots', TODAY)], context: [] },
      {
        bucket: 'soon',
        entries: [
          task('Write the cover letter', '2026-09-30'),
          item('Return window closes, Zara', '2026-10-01'),
        ],
        context: [],
      },
      { bucket: 'later', entries: [item('Return window closes, Uniqlo', '2026-10-09')], context: [] },
    ];
    expect(agendaFacts(piles, TODAY, ZONE)).toEqual([
      { kind: 'overdue', text: 'Renew passport' },
      { kind: 'today', text: 'Return window closes, Boots' },
      { kind: 'week', text: 'Thursday: Return window closes, Zara' },
    ]);
  });

  it('caps each kind and counts the rest', () => {
    const many = Array.from({ length: PER_KIND + 3 }, (_, n) => task(`Task ${n + 1}`, '2026-09-01'));
    const facts = agendaFacts([{ bucket: 'overdue', entries: many, context: [] }], TODAY, ZONE);
    expect(facts).toHaveLength(PER_KIND + 1);
    expect(facts.at(-1)).toEqual({ kind: 'overdue', text: 'and 3 more overdue' });
  });

  it('says nothing for an empty agenda', () => {
    expect(agendaFacts([], TODAY, ZONE)).toEqual([]);
  });
});

describe('goalFact', () => {
  const goal = { id: 'g1', title: 'Run a half marathon' } as Goal;
  const daily = (next: DailyGoal['next']): DailyGoal => ({ goal, areaName: 'Health', next, more: 0, hasSteps: true });

  it('names a question first, since nothing moves under it until it is answered', () => {
    const waiting: WaitingItem[] = [
      { kind: 'review', id: 'r', title: 'Weekly review', goalId: 'g1', goalTitle: goal.title },
      { kind: 'question', id: 'q', title: 'Which race?', goalId: 'g1', goalTitle: goal.title },
    ];
    const next = [{ id: 's', title: 'Buy shoes', kind: 'mine' as const, dueOn: null, under: null }];
    expect(goalFact({ goals: [daily(next)], waiting })?.text).toBe(
      'A question on your goal "Run a half marathon": Which race?',
    );
  });

  it('otherwise gives your next step, skipping Dash steps', () => {
    const next = [
      { id: 'c', title: 'Find training plans', kind: 'claude' as const, dueOn: null, under: null },
      { id: 's', title: 'Buy shoes', kind: 'mine' as const, dueOn: null, under: null },
    ];
    expect(goalFact({ goals: [daily(next)], waiting: [] })).toEqual({
      kind: 'goal',
      text: 'Your next step on "Run a half marathon": Buy shoes',
    });
    expect(goalFact({ goals: [daily([])], waiting: [] })).toBeNull();
  });
});

describe('news and Learn', () => {
  it('names the sender beside the headline when there is one', () => {
    expect(newsFact({ headline: 'Rates held', sender: 'The Brief' })?.text).toBe('Rates held (from The Brief)');
    expect(newsFact({ headline: 'Rates held', sender: null })?.text).toBe('Rates held');
    expect(newsFact(null)).toBeNull();
  });

  it('drops a blank question', () => {
    expect(learnFact('  ')).toBeNull();
    expect(learnFact('What does a bond yield measure?')).toEqual({
      kind: 'learn',
      text: 'What does a bond yield measure?',
    });
  });
});

describe('candidatesSince', () => {
  const NOW = new Date('2026-09-28T10:05:00Z');

  it('starts at the last brief, a day back without one, and never more than two days back', () => {
    expect(candidatesSince('2026-09-27T10:04:00Z', NOW)).toBe('2026-09-27T10:04:00.000Z');
    expect(candidatesSince(null, NOW)).toBe('2026-09-27T10:05:00.000Z');
    expect(candidatesSince('2026-09-20T10:00:00Z', NOW)).toBe('2026-09-26T10:05:00.000Z');
  });
});

describe('agendaCandidates', () => {
  it('marks interviews by the interview source, not every booked entry', () => {
    const interview: DayContext = {
      key: 'interview-round:g1:2026-09-28',
      ref: 'job_search.interview_groups:g1',
      day: TODAY,
      at: '2026-09-28T14:30:00Z',
      label: 'Respark · Product Designer',
      detail: 'Hiring screen',
      link: { href: '/jobs/roles/r1?tab=interviews&interview=i1', label: 'Prep' },
    };
    const piles: AgendaPile[] = [
      { bucket: 'today', entries: [], context: [booked('Team sync', '2026-09-28T14:30:00Z'), interview] },
    ];
    expect(agendaCandidates(piles, TODAY)).toEqual([
      {
        kind: 'interview',
        key: interview.key,
        title: 'Respark · Product Designer',
        href: '/jobs/roles/r1?tab=interviews&interview=i1',
        at: '2026-09-28T14:30:00Z',
        detail: 'Hiring screen',
      },
    ]);
  });

  it('keeps a return window closing today as a deadline and to-dos as the fallback kind', () => {
    const piles: AgendaPile[] = [
      { bucket: 'overdue', entries: [task('Renew passport', '2026-09-20')], context: [] },
      {
        bucket: 'today',
        entries: [item('Return window closes, Boots', TODAY), item('Parcel arrives', TODAY, 'deliveries'), task('Check mailbox', TODAY)],
        context: [],
      },
      { bucket: 'soon', entries: [task('Write the cover letter', '2026-09-30')], context: [] },
    ];
    const got = agendaCandidates(piles, TODAY);
    expect(got.map((c) => [c.kind, c.title])).toEqual([
      ['todo', 'Renew passport'],
      ['deadline', 'Return window closes, Boots'],
      ['todo', 'Check mailbox'],
    ]);
    expect(got[0]).toMatchObject({ overdue: true, dueOn: '2026-09-20', href: '/todo/all?status=all&focus=Renew passport' });
    expect(got[2]).toMatchObject({ overdue: false, dueOn: TODAY });
  });
});

describe('replyCandidates', () => {
  it('gives each open reply task its days waiting, the longest first', () => {
    const now = new Date('2026-09-28T10:05:00Z');
    const got = replyCandidates(
      [
        { task_id: 't2', title: 'Reply to Sam: Lunch', received_at: '2026-09-27T20:00:00Z' },
        { task_id: 't1', title: 'Reply to Maya: The offer', received_at: '2026-09-25T09:00:00Z' },
      ],
      now,
    );
    expect(got).toEqual([
      {
        kind: 'reply',
        key: 'task:t1',
        taskId: 't1',
        title: 'Reply to Maya: The offer',
        href: '/todo/all?status=all&focus=t1',
        receivedAt: '2026-09-25T09:00:00Z',
        daysWaiting: 3,
      },
      expect.objectContaining({ taskId: 't2', daysWaiting: 0 }),
    ]);
  });
});

describe('chargeCandidates', () => {
  const SINCE = '2026-09-27T10:00:00Z';
  function charge(over: Partial<ChargeCandidateRow>): ChargeCandidateRow {
    return {
      id: 'c',
      payment_id: 'p',
      payee: 'Netflix',
      event: 'charge',
      amount_cents: 1500,
      previous_amount_cents: null,
      currency: 'USD',
      period: 'month',
      due_on: null,
      created_at: '2026-09-20T00:00:00Z',
      ...over,
    };
  }

  it('keeps bills due today or tomorrow, one per payment, with the amount', () => {
    const got = chargeCandidates(
      [
        charge({ id: 'old', payment_id: 'loan', payee: 'Car loan', event: 'bill', due_on: TODAY, amount_cents: 32000, created_at: '2026-09-10T00:00:00Z' }),
        charge({ id: 'new', payment_id: 'loan', payee: 'Car loan', event: 'bill', due_on: TODAY, amount_cents: 32500, created_at: '2026-09-21T00:00:00Z' }),
        charge({ id: 'tv', payment_id: 'tv', payee: 'Hulu', event: 'renewal_notice', due_on: '2026-09-29' }),
        charge({ id: 'later', payment_id: 'gym', event: 'bill', due_on: '2026-09-30' }),
        charge({ id: 'taken', payment_id: 'x', event: 'charge', due_on: TODAY }),
      ],
      TODAY,
      SINCE,
    );
    expect(got).toEqual([
      {
        kind: 'bill',
        key: 'bill:new',
        title: 'Car loan',
        href: '/shopping/recurring',
        event: 'bill',
        dueOn: TODAY,
        dueIn: 0,
        amountCents: 32500,
        currency: 'USD',
      },
      expect.objectContaining({ kind: 'bill', key: 'bill:tv', title: 'Hulu', dueIn: 1, event: 'renewal_notice' }),
    ]);
  });

  it('keeps a rise read since the last brief with the old and new amounts, and not a fall or an old rise', () => {
    const got = chargeCandidates(
      [
        charge({ id: 'up', payment_id: 'spotify', payee: 'Spotify', event: 'price_change', amount_cents: 1500, previous_amount_cents: 1200, due_on: '2026-10-15', created_at: '2026-09-28T02:00:00Z' }),
        charge({ id: 'down', payment_id: 'icloud', amount_cents: 99, previous_amount_cents: 299, created_at: '2026-09-28T02:00:00Z' }),
        charge({ id: 'stale', payment_id: 'nyt', amount_cents: 2500, previous_amount_cents: 1700, created_at: '2026-09-25T00:00:00Z' }),
      ],
      TODAY,
      SINCE,
    );
    expect(got).toEqual([
      {
        kind: 'price-rise',
        key: 'price-rise:up',
        title: 'Spotify',
        href: '/shopping/recurring',
        amountCents: 1500,
        previousAmountCents: 1200,
        currency: 'USD',
        period: 'month',
        startsOn: '2026-10-15',
      },
    ]);
  });
});

describe('waitedOnStep', () => {
  const goal = (id: string, title: string): GoalCandidateItem => ({ id, parent_id: null, level: 'goal', kind: null, status: 'open', title });
  const step = (id: string, parent: string, kind: string, title: string, status = 'open'): GoalCandidateItem => ({
    id,
    parent_id: parent,
    level: 'step',
    kind,
    status,
    title,
  });
  const ITEMS: GoalCandidateItem[] = [
    goal('g1', 'Find a new job'),
    step('phase', 'g1', 'mine', 'Get ready'),
    step('cv', 'phase', 'mine', 'Send Dash your CV'),
    step('d1', 'g1', 'claude', 'Draft the cover letter'),
    step('d2', 'g1', 'claude', 'Tailor the CV'),
    step('m1', 'g1', 'mine', 'Apply to Respark'),
    step('done', 'g1', 'claude', 'Old draft', 'done'),
    step('pick', 'g1', 'mine', 'Pick three companies'),
  ];

  it('names the person\'s step with the most open steps waiting on it, and how many are Dash\'s', () => {
    const got = waitedOnStep(ITEMS, [
      { item_id: 'd1', depends_on_id: 'cv' },
      { item_id: 'd2', depends_on_id: 'cv' },
      { item_id: 'm1', depends_on_id: 'cv' },
      { item_id: 'done', depends_on_id: 'cv' },
      { item_id: 'm1', depends_on_id: 'pick' },
      { item_id: 'cv', depends_on_id: 'd1' },
    ]);
    expect(got).toEqual({
      kind: 'goal-step',
      key: 'goal-step:cv',
      title: 'Send Dash your CV',
      href: '/goals/g1/s/cv',
      goalTitle: 'Find a new job',
      waiting: 3,
      dashWaiting: 2,
    });
  });

  it('is none when nothing open waits on a step of theirs', () => {
    expect(waitedOnStep(ITEMS, [{ item_id: 'done', depends_on_id: 'cv' }])).toBeNull();
  });
});

describe('dashResultCandidates', () => {
  it('keeps results finished since the last brief, with the goal and the opening line', () => {
    const items: GoalCandidateItem[] = [
      { id: 'g1', parent_id: null, level: 'goal', kind: null, status: 'open', title: 'Find a new job' },
      { id: 's1', parent_id: 'g1', level: 'step', kind: 'claude', status: 'done', title: 'Shortlist ten companies' },
    ];
    const got = dashResultCandidates(
      [
        { id: 's1', title: 'Shortlist ten companies', result: '\nTen companies, three hiring now.\nMore below.', result_url: null, closed_at: '2026-09-28T03:00:00Z' },
        { id: 's0', title: 'Older result', result: 'Done', result_url: null, closed_at: '2026-09-26T03:00:00Z' },
      ],
      items,
      '2026-09-27T10:00:00Z',
    );
    expect(got).toEqual([
      {
        kind: 'dash-result',
        key: 'dash-result:s1',
        title: 'Shortlist ten companies',
        href: '/goals/g1/s/s1',
        goalTitle: 'Find a new job',
        result: 'Ten companies, three hiring now.',
        closedAt: '2026-09-28T03:00:00Z',
      },
    ]);
  });
});

describe('collectCandidates', () => {
  const reply: Candidate = {
    kind: 'reply',
    key: 'task:t1',
    taskId: 't1',
    title: 'Reply to Maya',
    href: null,
    receivedAt: '2026-09-25T09:00:00Z',
    daysWaiting: 3,
  };
  const todo: Candidate = {
    kind: 'todo',
    key: 'task:t1',
    taskId: 't1',
    title: 'Reply to Maya',
    href: null,
    dueOn: null,
    overdue: true,
    createdAt: '2026-09-25T09:00:00Z',
  };
  const bill: Candidate = {
    kind: 'bill',
    key: 'bill:c1',
    title: 'Car loan',
    href: null,
    event: 'bill',
    dueOn: TODAY,
    dueIn: 0,
    amountCents: 32000,
    currency: 'USD',
  };

  it('keeps what the parts that answered gave, when another part fails', async () => {
    const got = await collectCandidates([Promise.reject(new Error('todo down')), [bill]]);
    expect(got).toEqual([bill]);
  });

  it('keeps the first kind given for the same thing', async () => {
    expect(await collectCandidates([Promise.resolve([reply]), [todo, bill]])).toEqual([reply, bill]);
  });
});
