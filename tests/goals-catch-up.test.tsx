/**
 * The Goals home after time away (plan #1019).
 *
 * With a catch-up, the page opens on what Claude did while you were away,
 * then your move, then one next step per goal, and folds the goals and the
 * rest under "Everything else", closed. Without one it is the ordinary daily
 * view, leading with your move.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { catchUp } from '@/lib/goals/catch-up';
import type { DailyGoal, WaitingItem } from '@/lib/goals/daily';

vi.mock('@/app/goals/suggestion-actions', () => ({ reactToSuggestionAction: vi.fn() }));

const { DailyView } = await import('@/app/goals/daily-view');

const goal: DailyGoal = {
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
  next: [
    { id: 's1', title: 'List every balance', kind: 'mine', dueOn: null, under: null },
    { id: 's2', title: 'Call the card company', kind: 'mine', dueOn: null, under: null },
  ],
  more: 0,
  hasSteps: true,
};

const waiting: WaitingItem[] = [
  {
    kind: 'question',
    id: 'q1',
    title: 'Avalanche or snowball?',
    goalId: 'g1',
    goalTitle: 'Pay off the debts',
  },
];

const base = {
  goals: [goal],
  waiting,
  rhythms: [],
  suggestions: [],
  dash: { ready: [], held: [] },
};

function render(withCatchUp: boolean): string {
  const away = withCatchUp
    ? catchUp(
        '2026-09-18T08:00:00Z',
        [
          {
            id: 'r1',
            job: 'daily',
            status: 'done',
            createdAt: '2026-09-20T06:00:00Z',
            endedAt: '2026-09-20T06:10:00Z',
            summary: 'Drafted the payoff order',
            error: null,
            lastSeenAt: null,
            nowOn: null,
            item: null,
          },
        ],
        base,
      )
    : null;
  return renderToStaticMarkup(<DailyView view={{ ...base, catchUp: away }} timeZone="UTC" />);
}

describe('the Goals home after time away', () => {
  it('leads with the catch-up and folds the goal cards away', () => {
    const html = render(true);
    const order = [
      'While you were away',
      'Drafted the payoff order',
      'Your move',
      'Next for each goal',
      'Everything else',
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('href="/goals/runs/r1"');
    // Only the first next step is in the catch-up; the second waits in the goal's tree.
    const fold = html.indexOf('Everything else');
    expect(html.indexOf('List every balance')).toBeLessThan(fold);
    expect(html).not.toContain('Call the card company');
    expect(html).toMatch(/<details(?![^>]*open)[^>]*>/);
  });

  it('is the ordinary daily view without one', () => {
    const html = render(false);
    expect(html).not.toContain('While you were away');
    expect(html).not.toContain('Everything else');
    expect(html.indexOf('Your move')).toBeLessThan(html.indexOf('List every balance'));
    expect(html).toContain('Call the card company');
    expect(html.indexOf('List every balance')).toBeLessThan(html.indexOf('Dash is on it'));
  });
});
