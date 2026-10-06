/**
 * The Goals home (plan #1077): Dash's briefing with Ask Dash, every goal as a
 * tile with errands first, three lanes (On you, Dash has it, Later), and what
 * Dash did since your last visit with Read and Undo.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DoneSince } from '@/lib/goals/done-since';
import type { HomeGoal } from '@/lib/goals/home';
import type { GoalProgress } from '@/lib/goals/status';
import type { TodayItem } from '@/lib/goals/today';

vi.mock('@/app/goals/suggestion-actions', () => ({
  reactToSuggestionAction: vi.fn(),
  recordAttendedAction: vi.fn(),
}));
vi.mock('@/app/goals/runs/[runId]/actions', () => ({ undoRunChangeAction: vi.fn() }));
vi.mock('@/app/goals/[goalId]/actions', () => ({
  countRhythmAction: vi.fn(),
  setStepStatusAction: vi.fn(),
}));
vi.mock('@/app/goals/[goalId]/comment-actions', () => ({ addGoalComment: vi.fn() }));
vi.mock('@/app/goals/[goalId]/flag-actions', () => ({ answerFlagAction: vi.fn() }));
vi.mock('@/app/goals/[goalId]/tree-actions', () => ({ answerGoalQuestion: vi.fn() }));
vi.mock('@/app/goals/[goalId]/shaping-actions', () => ({
  askDashStepAction: vi.fn(),
  workOnGoalAction: vi.fn(),
}));
vi.mock('@/app/goals/home-actions', () => ({
  askDashAction: vi.fn(),
  setAsideAction: vi.fn(),
  restoreAsideAction: vi.fn(),
}));

const { HomeView } = await import('@/app/goals/home-view');

const progress: GoalProgress = {
  live: 5,
  done: 2,
  bands: { on_you: 2, waiting: 0, with_dash: 1, done: 2 },
  move: 'on_you',
  moves: { on_you: 2, with_dash: 1, waiting: 0, settled: 0 },
  questions: 1,
};

const goal: HomeGoal = {
  goal: {
    id: 'g1',
    areaId: 'area',
    title: 'Pay off the debts',
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
  },
  areaName: 'Money',
  progress,
  review: {
    id: 'r1',
    goalId: 'g1',
    verdict: 'waiting_on_you',
    reason: 'The order decides the next steps.',
    nextMove: 'Choose avalanche or snowball',
    nextOn: '2026-09-28',
    stepId: null,
    waitsOnId: null,
    runId: null,
    createdAt: '2026-09-26T06:00:00Z',
  },
  current: true,
  next: null,
  hasSteps: true,
};

function item(id: string, extra: Partial<TodayItem> = {}): TodayItem {
  return {
    kind: 'step',
    id,
    title: `Step ${id}`,
    detail: null,
    goalId: 'g1',
    goalTitle: 'Pay off the debts',
    action: 'Done',
    unblocks: 0,
    on: null,
    ...extra,
  };
}

const done: DoneSince = {
  since: '2026-09-24T08:00:00Z',
  items: [
    {
      kind: 'result',
      id: 's9',
      title: 'Drafted the payoff order',
      goalId: 'g1',
      goalTitle: 'Pay off the debts',
      href: '/goals/g1#step-s9',
      unread: true,
      runId: 'r1',
      undo: { runId: 'r1', key: '41', state: 'undoable', reason: null },
      at: '2026-09-25T06:10:00Z',
    },
  ],
  more: 0,
};

function render(extra: Partial<Parameters<typeof HomeView>[0]> = {}): string {
  return renderToStaticMarkup(
    <HomeView
      goals={[goal]}
      today={[
        item('q', {
          kind: 'question',
          title: 'Avalanche or snowball?',
          action: 'Answer',
          unblocks: 3,
        }),
        item('a'),
      ]}
      later={[item('b', { title: 'Call the card company' })]}
      done={done}
      brief={null}
      timeZone="UTC"
      health={{ dashFinished: 10, waitingOnYou: 3, stuck: 0, daysVisited: 1 }}
      {...extra}
    />,
  );
}

describe('the Goals home', () => {
  it('reads the briefing, the goals, the three lanes, then what Dash did', () => {
    const html = render({ brief: { body: 'The cake is due Sunday.', when: 'today' } });
    const order = [
      'The cake is due Sunday.',
      'Your one goal is waiting on you.',
      'Ask Dash',
      'Your goals',
      'href="/goals/g1"',
      'On you',
      'Avalanche or snowball?',
      'Dash has it',
      'Later',
      'What Dash did since',
      'Drafted the payoff order',
      'This week',
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const old of [
      'Your move',
      'Dash is on it',
      'Suggested this week',
      'While you were away',
    ]) {
      expect(html).not.toContain(old);
    }
  });

  it('ends with the week’s four numbers', () => {
    const html = render();
    const week = html.slice(html.indexOf('This week'));
    const order = [
      '10</dd>',
      'steps Dash finished',
      '3</dd>',
      'waiting on you',
      '0</dd>',
      'steps of yours untouched for a week',
      '1</dd>',
      'day you visited',
    ];
    const positions = order.map((text) => week.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(render({ health: null })).toContain('The week’s numbers could not be read just now.');
  });

  it('gives each thing on you one button and Not now, with everything in the lane', () => {
    const html = render();
    expect(html).toContain('>Answer<');
    expect(html).toContain('>Done<');
    expect(html).toContain('Not now');
    const asks = (markup: string) => markup.split('Ask Dash</button>').length - 1;
    // Ask Dash on a step of yours shows only to the owner, who alone can start a run.
    expect(asks(render({ preparable: ['a'], canRun: true }))).toBe(asks(html) + 1);
    expect(asks(render({ preparable: ['a'] }))).toBe(asks(html));
    expect(html).toContain('frees 3 steps');
    expect(html).toContain('Call the card company');
  });

  it('shows the first six on you and the rest behind Show more', () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`m${i}`, { title: `Errand ${i}` }));
    const html = render({ today: many.slice(0, 5), later: many.slice(5) });
    expect(html).toContain('Errand 5');
    expect(html).not.toContain('Errand 6');
    expect(html).toContain('Show 2 more');
  });

  it('fills Dash’s lane and Later', () => {
    const html = render({
      dash: [
        { id: 'c1', title: 'Draft the payoff order', goalId: 'g1', goalTitle: 'Pay off the debts', kind: 'step', working: true, needs: null },
        { id: 'c2', title: 'Find the card APRs', goalId: 'g1', goalTitle: 'Pay off the debts', kind: 'step', working: false, needs: 'Which cards do you have?' },
      ],
      laterOn: [
        { id: 'l1', title: 'Turn on autopay', goalId: 'g1', goalTitle: 'Pay off the debts', startsOn: '2026-11-01', dueOn: null },
      ],
    });
    expect(html).toContain('Dash is on it');
    expect(html).toContain('Dash is working on this now.');
    expect(html).toContain('Needs you: Which cards do you have?');
    expect(html).toContain('Turn on autopay');
    expect(html).toContain('back 1 Nov');
    expect(html).toContain('Bring back now');
  });

  it('shows each goal with its status, progress, and its next move with its date on hover', () => {
    const html = render();
    expect(html).toContain('Waiting on you');
    expect(html).toContain('2/5');
    expect(html).toContain('title="Next: Choose avalanche or snowball, 28 Sept"');
    expect(html).not.toContain('as of');
    const stale = render({ goals: [{ ...goal, current: false }] });
    expect(stale).toContain('as of');
  });

  it('lists what Dash did with Read and Undo', () => {
    const html = render();
    expect(html).toMatch(/href="\/goals\/g1#step-s9"[^>]*>Read</);
    expect(html).toContain('>Undo<');
    expect(render({ done: { ...done, items: [] } })).toContain(
      'Nothing new since your last visit.',
    );
  });

  it('puts errands first on the board, soonest due first, each with how long it has', () => {
    const errand = (id: string, title: string, dueOn: string): HomeGoal => ({
      ...goal,
      goal: { ...goal.goal, id, title, errand: true, dueOn },
      review: null,
    });
    const html = render({
      goals: [
        goal,
        errand('e2', 'Book the car service', '2026-10-20'),
        errand('e1', 'Give Sam a live electronic show for her birthday', '2026-10-09'),
      ],
      todayOn: '2026-10-02',
      areas: [{ id: 'area', name: 'Money' }],
    });
    const board = html.slice(html.indexOf('Your goals'), html.indexOf('On you'));
    const order = [
      'Due 9 Oct',
      'in 7 days',
      'Give Sam a live electronic show',
      'Due 20 Oct',
      'Book the car service',
      'Pay off the debts',
    ];
    const positions = order.map((text) => board.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('says on each tile how much is on you', () => {
    const html = render({
      holders: { g1: { onYou: 3, dashOpen: 2, working: null, lastDashAt: null } },
    });
    expect(html).toContain('3 on you');
  });

  it('offers goals Dash has left alone in its lane, and a new goal or errand once there is an area', () => {
    const offers = [
      { kind: 'goal' as const, goalId: 'g1', title: 'Pay off the debts', reason: 'Dash has not worked on it yet.' },
    ];
    const asks = (markup: string) => markup.split('Ask Dash</button>').length - 1;
    // Only the owner's account can start a run, so only it is offered Ask Dash.
    expect(asks(render({ offers, canRun: true }))).toBe(asks(render({ offers })) + 1);
    const html = render({
      canRun: true,
      offers: [
        { kind: 'prepare', stepId: 'a', title: 'Call the card company', goalId: 'g1', goalTitle: 'Pay off the debts' },
        { kind: 'goal', goalId: 'g1', title: 'Pay off the debts', reason: 'Dash has not worked on it yet.' },
      ],
    });
    expect(html).toContain('Dash could take these');
    expect(html).toContain('Dash has not worked on it yet.');
    expect(html).not.toContain('A new errand');
    expect(html).not.toContain('A new goal');
    const withArea = render({ areas: [{ id: 'area', name: 'Money' }] });
    expect(withArea).toContain('A new errand');
    expect(withArea).toContain('A new goal');
  });

  it('leads with what Dash did and leaves out the week on the day you come back', () => {
    const html = render({ awayFrom: '2026-09-18T21:30:00Z', todayOn: '2026-09-24' });
    expect(html).toContain('You were away 6 days');
    expect(html.indexOf('What Dash did')).toBeLessThan(html.indexOf('On you'));
    expect(html).not.toContain('This week');
  });

  it('offers to add a goal when there are none', () => {
    expect(render({ goals: [], today: [], later: [] })).toContain('No goals yet');
  });
});
