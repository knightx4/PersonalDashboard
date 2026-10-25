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
vi.mock('@/app/goals/inbox/actions', () => ({
  snoozeInboxRowAction: vi.fn(),
  unsnoozeInboxRowAction: vi.fn(),
  leaveQuestionsAction: vi.fn(),
}));
vi.mock('@/app/goals/[goalId]/shaping-actions', () => ({
  askDashStepAction: vi.fn(),
  workOnGoalAction: vi.fn(),
}));
vi.mock('@/app/goals/home-actions', () => ({
  askDashAction: vi.fn(),
  setAsideAction: vi.fn(),
  restoreAsideAction: vi.fn(),
  bringBackAction: vi.fn(),
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
  item('c', { kind: 'close', title: 'Close Pay off the debts?', action: 'Done' }),
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

describe('folding rows that say one thing', () => {
  const questions = ['q1', 'q2', 'q3'].map((id) =>
    item(id, {
      kind: 'question',
      title: `Do you still want ${id}?`,
      action: 'Answer',
      goalId: 'home',
      goalTitle: 'Make the apartment livable',
    }),
  );
  const parks = ['p1', 'p2'].map((id) =>
    item(id, { kind: 'park', title: 'Nothing done in 22 days: park the goal', action: 'Later', goalId: id, goalTitle: `Goal ${id}` }),
  );
  const many = [...onYou, ...questions, ...parks];

  it("folds a goal's questions into one row, and the parks into another", () => {
    const groups = goalInboxGroups(many, []);
    expect(groups[1].items.map((i) => i.id)).toEqual(['q', 'f']);
    expect(groups[1].bundles).toMatchObject([
      {
        key: 'questions:home',
        title: '3 questions from Dash on Make the apartment livable',
        detail: 'Do you still want q1? and 2 more',
      },
    ]);
    expect(groups[1].bundles[0].items.map((i) => i.id)).toEqual(['q1', 'q2', 'q3']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['c']);
    expect(groups[2].bundles).toMatchObject([
      { key: 'park', title: '2 goals have had nothing done in three weeks', detail: 'Goal p1, Goal p2' },
    ]);
    // The four rows from before, and one each for the two folds.
    expect(goalInboxCount(many, [])).toBe(6);
  });

  it('leaves a single question and a single park as their own rows', () => {
    const groups = goalInboxGroups([questions[0], parks[0]], []);
    expect(groups[1].bundles).toEqual([]);
    expect(groups[1].items.map((i) => i.id)).toEqual(['q1']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['p1']);
  });

  it('draws the fold with Leave them as they are, and the questions one by one inside', () => {
    const html = renderToStaticMarkup(
      <GoalsInboxView groups={goalInboxGroups(many, [])} laterOn={[]} preparable={[]} canRun={false} />,
    );
    expect(html).toContain('3 questions from Dash on Make the apartment livable');
    expect(html).toContain('Leave them as they are');
    expect(html).toContain('Answer them one by one');
    expect(html).toContain('Do you still want q2?');
    expect(html).toContain('6 things waiting on you');
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

  it('counts each section on its heading, and the total after them', () => {
    const html = render();
    expect(html).toMatch(/Questions for you<span[^>]*>3</);
    expect(html).toContain('5 things waiting on you');
    expect(html).toContain('id="inbox-actions"');
    expect(html).toContain('Pay the card');
    expect(html).toContain('Needs you: Which card has the lower rate?');
  });

  it('says so when nothing is on you, and folds what was put off under Later', () => {
    const html = render({
      groups: goalInboxGroups([], []),
      laterOn: [
        { id: 'l1', title: 'Turn on autopay', goalId: 'g1', goalTitle: 'Pay off the debts', startsOn: '2026-11-01', dueOn: null },
      ],
    });
    expect(html).toContain('Nothing waiting on you');
    expect(html).toContain('Later');
    expect(html).toContain('Turn on autopay');
    expect(html).not.toContain('Your actions');
  });
});
