/**
 * The Goals home (plan #1077): a sentence on where the goals stand, Today
 * with one button a row and the rest folded under it, one line per goal
 * under its area, and what Dash did since your last visit with Read and
 * Undo. None of the old home's sections are left.
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

const { HomeView } = await import('@/app/goals/home-view');

const progress: GoalProgress = {
  live: 5,
  done: 2,
  bands: { on_you: 2, waiting: 0, with_claude: 1, done: 2 },
  move: 'on_you',
  moves: { on_you: 2, with_claude: 1, waiting: 0, settled: 0 },
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
  it('reads summary, Today, the goals, then what Dash did', () => {
    const html = render();
    const order = [
      'Your one goal is waiting on you.',
      'Today',
      'Avalanche or snowball?',
      'Your goals',
      'Choose avalanche or snowball',
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

  it('gives each thing today one button, and folds the rest under them', () => {
    const html = render();
    expect(html).toContain('>Answer<');
    expect(html).toContain('>Done<');
    expect(html).toContain('frees 3 steps');
    expect(html).toContain('Also on you');
    expect(html).toContain('Call the card company');
    expect(html).toMatch(/<details(?![^>]*open)[^>]*>/);
  });

  it('shows each goal with its status, progress and next move with its date', () => {
    const html = render();
    expect(html).toContain('Waiting on you');
    expect(html).toContain('2 of 5');
    expect(html).toContain('Choose avalanche or snowball');
    expect(html).toContain('28 Sep');
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

  it('offers to add a goal when there are none', () => {
    expect(render({ goals: [], today: [], later: [] })).toContain('No goals yet');
  });
});
