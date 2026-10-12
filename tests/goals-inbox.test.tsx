/**
 * The Inbox in Goals: everything on you, sorted by what finishes it, with the
 * overview of counts at the top and what you set aside folded at the bottom.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { goalInboxCount, goalInboxGroups } from '@/lib/goals/inbox';
import type { DashLaneItem } from '@/lib/goals/lanes';
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

const { GoalsInboxView } = await import('@/app/goals/inbox/inbox-view');

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

const blocked: DashLaneItem = {
  id: 'd1',
  title: 'Compare the two cards',
  goalId: 'g1',
  goalTitle: 'Pay off the debts',
  kind: 'step',
  working: false,
  needs: 'Which card has the lower rate?',
};

const onYou = [
  item('a', { title: 'Pay the card' }),
  item('q', { kind: 'question', title: 'Avalanche or snowball?', action: 'Answer' }),
  item('f', { kind: 'flag', title: 'A late fee was charged', action: 'Answer' }),
  item('c', { kind: 'close', title: 'Close Pay off the debts?', action: 'Close goal' }),
];

describe('sorting what is on you', () => {
  it('puts each kind in the group that finishes it, keeping the ranking', () => {
    const groups = goalInboxGroups(onYou, [blocked, { ...blocked, id: 'd2', needs: null }]);
    expect(groups.map((group) => group.key)).toEqual(['actions', 'questions', 'review']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['q', 'f']);
    // Only a Dash step that stopped on a question for you.
    expect(groups[1].dash.map((d) => d.id)).toEqual(['d1']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['c']);
    expect(goalInboxCount(onYou, [blocked, { ...blocked, id: 'd2', needs: null }])).toBe(5);
  });
});

describe('the Inbox page', () => {
  const render = (over: Partial<Parameters<typeof GoalsInboxView>[0]> = {}) =>
    renderToStaticMarkup(
      <GoalsInboxView
        groups={goalInboxGroups(onYou, [blocked])}
        laterOn={[]}
        preparable={[]}
        canRun={false}
        {...over}
      />,
    );

  it('opens on the counts, each a link to its section', () => {
    const html = render();
    expect(html).toMatch(/href="#inbox-questions"[^>]*><span[^>]*>3</);
    expect(html).toContain('id="inbox-actions"');
    expect(html).toContain('Pay the card');
    expect(html).toContain('Needs you: Which card has the lower rate?');
  });

  it('says so when nothing is on you, and folds what was set aside', () => {
    const html = render({
      groups: goalInboxGroups([], []),
      laterOn: [
        { id: 'l1', title: 'Turn on autopay', goalId: 'g1', goalTitle: 'Pay off the debts', startsOn: '2026-11-01', dueOn: null },
      ],
    });
    expect(html).toContain('Nothing waiting on you');
    expect(html).toContain('Set aside');
    expect(html).toContain('Turn on autopay');
    expect(html).not.toContain('Your actions');
  });
});
