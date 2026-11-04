import { describe, expect, it } from 'vitest';
import type { RosterAdvisor } from '@/lib/you/board-advisors';
import type { Brain } from '@/lib/you/board-brain';
import {
  advisorSystem,
  chatTitle,
  memoriesFrom,
  memoryPrompt,
  messageTurn,
  MEMORIES_PER_EXCHANGE,
  openersFor,
  receiptsFrom,
  receiptsOf,
  unanswered,
  type TalkContext,
} from './advisor-talk';

const buffett: RosterAdvisor = {
  id: 'a1',
  key: 'buffett',
  name: 'Warren Buffett',
  kind: 'guest',
  question: 'Will you still be glad of this in twenty years?',
  focus: null,
  brainStatus: 'ready',
  failure: null,
  sources: 12,
  active: true,
  addedBy: 'person',
  updatedAt: '2026-11-01T00:00:00Z',
  avatar: { style: 'notionists', seed: 'buffett', options: {} } as unknown as RosterAdvisor['avatar'],
  assessment: 'The twenty-year owner’s test',
};

const brain: Brain = {
  version: 2,
  assessment: { name: 'The twenty-year owner’s test', text: 'Rates each option as if you had to own it for twenty years.' },
  evidence: ['Your own record inside the field'],
  questions: ['Could you explain in one paragraph why this is worth more in ten years?'],
  rules: ['Stay inside the circle of competence (Letter, 1996).'],
  frameworks: [{ name: 'Margin of safety', text: 'Leave room for being wrong.' }],
  positions: [{ topic: 'Debt', text: 'Avoid it.' }],
  contrarian: [{ common: 'diversify widely', text: 'concentrate on what you know' }],
  disagreements: [{ advisor: 'dreamer', text: 'Big bets outside the circle.' }],
  stories: [{ date: '1965', text: 'Bought Berkshire Hathaway out of spite.', source: 'https://example.com' }],
  never: ['Time the market.'],
  voice: 'Folksy, plain, with homely analogies.',
  sources: [],
};

const context: TalkContext = {
  advisor: buffett,
  brain,
  memory: [
    { id: 'm1', kind: 'commitment', text: 'You said you would answer Meridian by 14 November.', createdAt: '2026-11-02T09:00:00Z' },
  ],
  decisions: [
    {
      questionId: 'q1',
      meetingId: 'mt1',
      question: 'Take the Meridian offer?',
      options: [
        { letter: 'A', text: 'Take it' },
        { letter: 'B', text: 'Wait' },
      ],
      forecast: { A: 0.7, B: 0.3 },
      pick: 'A',
      chosen: null,
      decidedAt: null,
      outcome: null,
      brier: null,
      askedAt: '2026-10-30T00:00:00Z',
    },
  ],
  open: [{ id: 'q2', question: 'Do I move to Chicago in the spring?' }],
  goals: [{ title: 'Pay off student debt', dueOn: '2027-06-01' }],
};

describe('advisorSystem', () => {
  const system = advisorSystem(context);

  it('speaks as the advisor, from their brain, and never as Dash', () => {
    expect(system).toContain('You are Warren Buffett');
    expect(system).toContain('an impression of Warren Buffett drawn from their public work');
    expect(system).toContain('The twenty-year owner’s test');
    expect(system).toContain('Folksy, plain');
    expect(system).toContain('Stay inside the circle of competence');
    expect(system).toContain('Bought Berkshire Hathaway');
    expect(system).toContain('never Dash');
    expect(system).toContain('I never wrote about that');
  });

  it('asks for real numbers from the lookups, cited', () => {
    expect(system).toContain('never guess one');
    expect(system).toContain('cited');
  });

  it('tells them what they remember first, the decisions, open questions and goals', () => {
    const memory = system.indexOf('WHAT YOU REMEMBER ABOUT THEM');
    expect(memory).toBeGreaterThan(0);
    expect(system).toContain('[commitment, 2026-11-02] You said you would answer Meridian by 14 November.');
    expect(system.indexOf('DECISIONS YOU WEIGHED IN ON')).toBeGreaterThan(memory);
    expect(system).toContain('"Take the Meridian offer?" (asked 2026-10-30): Take it 70%, Wait 30%; not decided yet.');
    expect(system).toContain('- Do I move to Chicago in the spring?');
    expect(system).toContain('- Pay off student debt (due 2027-06-01)');
  });

  it('says so when there is nothing remembered yet, and works without a brain', () => {
    const bare = advisorSystem({ ...context, brain: null, memory: [], advisor: { ...buffett, kind: 'seat', name: 'CFO' } });
    expect(bare).toContain('Nothing yet: this is the first time you talk with them.');
    expect(bare).toContain('THE QUESTION YOU OWN');
    expect(bare).toContain('You are the CFO on the person');
    expect(bare).not.toContain('public work');
  });
});

describe('openersFor', () => {
  it('draws three from the open decisions first, then goals, then the brain', () => {
    const openers = openersFor({ advisor: buffett, brain, open: context.open, goals: context.goals });
    expect(openers.map((o) => o.shown)).toEqual([
      'Do I move to Chicago in the spring?',
      'My goal: Pay off student debt',
      'Could you explain in one paragraph why this is worth more in ten years?',
    ]);
    expect(openers[0].send).toBe('What would you want to know before I decide: Do I move to Chicago in the spring?');
  });

  it('falls back to a general opener and their question, with nothing to draw from', () => {
    expect(openersFor({ advisor: buffett, brain: null, open: [], goals: [] })).toHaveLength(2);
  });
});

describe('memoriesFrom', () => {
  const known = [{ id: 'm1', text: 'You owe $18,420 on your Navient loan.' }];

  it('keeps known kinds, drops repeats and caps the count', () => {
    const out = memoriesFrom(
      {
        remember: [
          { kind: 'fact', text: 'You owe $18,420 on your Navient loan' },
          { kind: 'mood', text: 'Tired' },
          { kind: 'commitment', text: '  You will answer Meridian by Friday.  ' },
          ...Array.from({ length: 6 }, (_, i) => ({ kind: 'fact', text: `Fact ${i}` })),
        ],
        retire: [1, 2, 'x'],
      },
      known,
    );
    expect(out.remember[0]).toEqual({ kind: 'commitment', text: 'You will answer Meridian by Friday.' });
    expect(out.remember).toHaveLength(MEMORIES_PER_EXCHANGE);
    expect(out.retire).toEqual(['m1']);
  });

  it('reads nothing from the wrong shape', () => {
    expect(memoriesFrom(null, known)).toEqual({ remember: [], retire: [] });
  });

  it('numbers what is already remembered for the pass', () => {
    expect(memoryPrompt({ memory: [{ kind: 'fact', text: 'A' }], person: 'hi', advisor: 'hello', advisorName: 'CFO' })).toContain(
      '1. [fact] A',
    );
  });
});

describe('messages', () => {
  it('turns receipts into citations and back', () => {
    const receipts = receiptsFrom([{ table: 'jobs.roles', ref: 'r1', title: 'Meridian', href: '/jobs/roles/r1' }]);
    expect(receiptsOf(receipts)).toEqual(receipts);
    expect(receiptsOf([{ label: '', link: 'x' }, 'no'])).toEqual([]);
    const turn = messageTurn({ id: 'x', role: 'advisor', text: 'Hi', receipts, createdAt: '2026-11-01T00:00:00Z' });
    expect(turn).toMatchObject({ role: 'assistant', citations: [{ table: 'jobs.roles', ref: 'r1', title: 'Meridian' }] });
    expect(messageTurn({ id: 'y', role: 'person', text: 'Yo', receipts: [], createdAt: '' }).citations).toBeUndefined();
  });

  it('finds the person’s message no reply followed', () => {
    expect(unanswered([{ id: '1', role: 'person', text: 'a' }])).toEqual({ id: '1', text: 'a' });
    expect(unanswered([{ id: '1', role: 'person', text: 'a' }, { id: '2', role: 'advisor', text: 'b' }])).toBeNull();
    expect(unanswered([])).toBeNull();
  });

  it('titles a talk by its first words, cut at a word', () => {
    expect(chatTitle('Short one')).toBe('Short one');
    const long = chatTitle('word '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
