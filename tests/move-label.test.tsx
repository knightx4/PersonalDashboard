/**
 * One whose-move label on the dev plan and on Goals (plan #1433): the same
 * state draws the same word in the same colour wherever it comes from.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoveLabel } from '@/components/ui/move-label';
import { GoalProgress } from '@/app/goals/goal-progress';
import { MOVE_WORD, VIEW_LABEL } from '@/lib/core/move';
import { moveFor } from '@/lib/plan/health-words';
import { goalMoveLabel, type GoalProgress as Progress } from '@/lib/goals/status';

const goal = (move: Progress['move']): Progress => ({
  live: 3,
  done: 1,
  bands: { on_you: 1, waiting: 0, with_dash: 1, done: 1 },
  move,
  moves: { on_you: 1, with_dash: 1, waiting: 0, settled: 0 },
  questions: 0,
});

describe('MoveLabel', () => {
  it('draws the shared word and tone, with the tooltip it is given', () => {
    const html = renderToStaticMarkup(<MoveLabel move={{ state: 'on_you' }} title="Stopped on you." />);
    expect(html).toContain('On you');
    expect(html).toContain('text-caution');
    expect(html).toContain('title="Stopped on you."');
  });

  it('puts the working mark beside Dash is on it, and nowhere else', () => {
    expect(renderToStaticMarkup(<MoveLabel move={{ state: 'dash_working' }} />)).toContain(
      'data-dash-state="working"',
    );
    expect(renderToStaticMarkup(<MoveLabel move={{ state: 'with_dash' }} />)).not.toContain(
      'data-dash-state',
    );
  });

  it('names who a waiting row waits on', () => {
    expect(
      renderToStaticMarkup(<MoveLabel move={{ state: 'waiting', waitingOn: '#1453' }} />),
    ).toContain('Waiting on #1453');
  });
});

describe('the plan and a goal say the same word for the same state', () => {
  it.each(['on_you', 'with_dash', 'waiting'] as const)('%s', (state) => {
    const plan = moveFor(state, state);
    const ofGoal = goalMoveLabel(goal(state));
    expect(plan.move).toEqual(ofGoal.move);
    expect(plan.word).toBe(MOVE_WORD[state]);
    expect(ofGoal.word).toBe(MOVE_WORD[state]);
    expect(renderToStaticMarkup(<GoalProgress progress={goal(state)} label="A goal" />)).toContain(
      MOVE_WORD[state],
    );
  });

  it('names the step a plan row waits on only when the wait is its own', () => {
    expect(moveFor('waiting', 'waiting', '#9').word).toBe('Waiting on #9');
    expect(moveFor('waiting', 'none', '#9').word).toBe('Waiting');
  });

  it('says nothing for a settled goal or a plan row waiting its turn', () => {
    expect(goalMoveLabel(goal('settled')).move).toBeNull();
    expect(moveFor('none', 'none').move).toBeNull();
  });
});

describe('the view chips', () => {
  it('are one list, with the move words where a view is a move', () => {
    expect(VIEW_LABEL.you).toBe(MOVE_WORD.on_you);
    expect(VIEW_LABEL.blocked).toBe(MOVE_WORD.waiting);
  });
});
