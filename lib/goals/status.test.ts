import { describe, expect, it } from 'vitest';
import {
  goalMoveLabel,
  goalProgress,
  questionsBeneath,
  stepHealth,
  stepNeeds,
  stepState,
} from './status';
import type { StepNode } from './steps';

function node(id: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'goal',
    kind: 'mine',
    status: 'open',
    title: id,
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

describe('stepState', () => {
  it('gives every open step one of the three words', () => {
    expect(stepState(node('a')).word).toBe('On you');
    expect(stepState(node('b', { kind: 'claude' })).word).toBe('With Claude');
    expect(stepState(node('c', { children: [node('d')] })).word).toBe('Waiting');
    expect(stepState(node('e', { kind: 'rhythm' })).word).toBe('On you');
  });

  it('reads a step for later as waiting, with the day it starts', () => {
    const later = stepState(node('a', { startsOn: '2026-11-01', waitsUntil: '2026-11-01' }));
    expect(later).toMatchObject({ health: 'later', move: 'waiting', word: 'Waiting' });
    expect(later.title).toContain('Starts 1 Nov');
    // Once the day has come the loader leaves the mark off, and it is yours again.
    expect(stepState(node('b', { startsOn: '2026-09-01' })).word).toBe('On you');
  });

  it('puts proposals, questions and unread results on you', () => {
    expect(stepHealth(node('a', { status: 'proposed', kind: 'claude' }))).toBe('proposed');
    expect(stepHealth(node('b', { kind: 'decision' }))).toBe('unanswered');
    const read = node('c', { kind: 'claude', status: 'done', result: 'Notes' });
    expect(stepHealth(read)).toBe('review');
    expect(stepState(read).word).toBe('On you');
  });

  it('draws the plan glyphs and tones', () => {
    expect(stepState(node('q', { kind: 'decision' }))).toMatchObject({
      glyph: 'question',
      tone: 'caution',
    });
    expect(stepState(node('c', { kind: 'claude' }))).toMatchObject({
      glyph: 'three-quarters',
      tone: 'info',
    });
    expect(stepState(node('w', { children: [node('x')] }))).toMatchObject({
      glyph: 'dashed',
      tone: 'caution',
    });
  });

  it('says what a waiting step waits on', () => {
    const parent = node('p', {
      children: [node('x'), node('y', { kind: 'claude' }), node('z', { status: 'done' })],
    });
    expect(stepState(parent).title).toBe(
      'Waits on the 2 open steps under it: 1 on you, 1 with Claude.',
    );
  });

  it('does not wait on a question put aside or a proposal', () => {
    const parent = node('p', {
      children: [
        node('q', { kind: 'decision', dismissedAt: '2026-09-20T00:00:00Z' }),
        node('r', { status: 'proposed' }),
      ],
    });
    expect(stepHealth(parent)).toBe('yours');
  });

  it('names a closed step instead', () => {
    expect(stepState(node('a', { status: 'done' })).word).toBe('Done');
    expect(stepState(node('b', { status: 'dropped' })).word).toBe('Dropped');
    const answered = stepState(node('c', { kind: 'decision', status: 'done', resolution: 'B' }));
    expect(answered).toMatchObject({ word: 'Answered', title: 'Answered: B', glyph: 'check' });
  });

  it('says a put-aside question is waiting, not on you', () => {
    const state = stepState(node('q', { kind: 'decision', dismissedAt: '2026-09-20T00:00:00Z' }));
    expect(state.word).toBe('Waiting');
  });
});

describe('questionsBeneath', () => {
  it('counts unanswered questions under a step and not put-aside ones', () => {
    const parent = node('p', {
      children: [
        node('q1', { kind: 'decision' }),
        node('s', { children: [node('q2', { kind: 'decision' })] }),
        node('q3', { kind: 'decision', dismissedAt: '2026-09-20T00:00:00Z' }),
      ],
    });
    expect(questionsBeneath(parent)).toBe(2);
    expect(questionsBeneath(node('q', { kind: 'decision' }))).toBe(0);
  });
});

describe('goalProgress', () => {
  it('counts the steps that are the work, closed against open', () => {
    const steps = [
      node('phase', {
        children: [node('a', { status: 'done' }), node('b'), node('c', { kind: 'claude' })],
      }),
      node('d', { status: 'done' }),
      node('e', { status: 'proposed' }),
      node('f', { status: 'dropped' }),
      node('q', { kind: 'decision' }),
    ];
    const progress = goalProgress(steps);
    expect(progress.live).toBe(5);
    expect(progress.done).toBe(2);
    expect(progress.bands).toEqual({ on_you: 2, waiting: 0, with_claude: 1, done: 2 });
    expect(progress.move).toBe('on_you');
    expect(progress.questions).toBe(1);
  });

  it('counts a parent whose sub-steps are all proposed as the work itself', () => {
    const progress = goalProgress([node('p', { children: [node('x', { status: 'proposed' })] })]);
    expect(progress.live).toBe(1);
    expect(progress.bands.on_you).toBe(1);
  });

  it('reports Claude when nothing is on you', () => {
    const progress = goalProgress([node('a', { kind: 'claude' }), node('b', { status: 'done' })]);
    expect(goalMoveLabel(progress)).toMatchObject({ word: 'With Claude', tone: 'info' });
  });

  it('has nothing to say about an empty or finished goal', () => {
    expect(goalProgress([]).live).toBe(0);
    expect(goalProgress([node('a', { status: 'done' })]).move).toBe('settled');
  });
});

describe('stepNeeds', () => {
  it('names the open steps a waiting step waits on', () => {
    const parent = node('p', {
      children: [
        node('Get the numbers'),
        node('Check refinancing', { kind: 'claude' }),
        node('Old', { status: 'done' }),
        node('Maybe', { status: 'proposed' }),
      ],
    });
    expect(stepNeeds(parent)).toBe(
      'Get the numbers (on you), Check refinancing (with Claude) to close first.',
    );
  });

  it('counts the open steps past the first three', () => {
    const parent = node('p', {
      children: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id)),
    });
    expect(stepNeeds(parent)).toBe('a (on you), b (on you), c (on you), 2 more to close first.');
  });

  it('asks for approval on a proposal and says nothing when nothing holds a step', () => {
    expect(stepNeeds(node('p', { status: 'proposed' }))).toMatch(/^Your approval/);
    expect(stepNeeds(node('a'))).toBeNull();
    expect(stepNeeds(node('q', { kind: 'decision' }))).toBeNull();
    expect(stepNeeds(node('d', { status: 'done', children: [node('x')] }))).toBeNull();
  });
});
