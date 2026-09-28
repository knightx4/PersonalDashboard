import { describe, expect, it } from 'vitest';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import type { AgendaItem, DayContext } from '@/lib/todo/agenda/sources';
import type { Task } from '@/lib/todo/tasks/model';
import type { DailyGoal, WaitingItem } from '@/lib/goals/daily';
import type { Goal } from '@/lib/goals/tree';
import {
  agendaFacts,
  briefDay,
  checkBrief,
  factsPrompt,
  goalFact,
  isQuiet,
  learnFact,
  newsFact,
  PER_KIND,
  plainBrief,
  QUIET_LINE,
  type BriefFact,
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
  return { key: label, day: TODAY, at, label, detail, link: null };
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

describe('a quiet day', () => {
  it('is one line, even with a news story and a Learn question', () => {
    const facts: BriefFact[] = [
      { kind: 'news', text: 'Rates held' },
      { kind: 'learn', text: 'What is a yield?' },
    ];
    expect(isQuiet(facts)).toBe(true);
    expect(plainBrief(facts)).toBe(QUIET_LINE);
  });

  it('is not quiet when anything is booked, due, closing or waiting', () => {
    expect(isQuiet([{ kind: 'week', text: 'Thursday: Return window closes, Zara' }])).toBe(false);
    expect(isQuiet([{ kind: 'goal', text: 'Your next step' }])).toBe(false);
  });
});

describe('plainBrief', () => {
  it('gives one sentence per heading, in the order the model is asked for', () => {
    expect(
      plainBrief([
        { kind: 'overdue', text: 'Renew passport' },
        { kind: 'booked', text: '09:30: Interview with Acme' },
        { kind: 'overdue', text: 'Call the bank' },
      ]),
    ).toBe('Booked today: 09:30: Interview with Acme. Overdue: Renew passport; Call the bank.');
  });
});

describe('factsPrompt', () => {
  it('opens on the day and lists only the headings that have lines', () => {
    const prompt = factsPrompt(TODAY, [
      { kind: 'booked', text: '09:30: Interview with Acme' },
      { kind: 'learn', text: 'What is a yield?' },
    ]);
    expect(prompt).toBe(
      [
        'Today is Monday 2026-09-28.',
        '',
        'Booked today:',
        '- 09:30: Interview with Acme',
        '',
        "Today's Learn question:",
        '- What is a yield?',
      ].join('\n'),
    );
  });
});

describe('checkBrief', () => {
  it('turns dashes into commas and collapses whitespace', () => {
    expect(checkBrief('  You have the Acme interview at 09:30 — then\n the dentist.  ')).toBe(
      'You have the Acme interview at 09:30, then the dentist.',
    );
  });

  it('refuses an empty or overlong brief', () => {
    expect(checkBrief('   ')).toBeNull();
    expect(checkBrief('word '.repeat(300))).toBeNull();
  });
});
