import { describe, expect, it } from 'vitest';
import { goalStrip, openLeaves } from './goal-strip';
import type { StatusRow } from './goal-status';
import type { StepNode } from './steps';

function node(id: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'g',
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

const answer: StatusRow = {
  id: 'q',
  kind: 'question',
  label: 'Answer',
  title: 'Which card first?',
  href: '?tab=plan#step-q',
};

describe('openLeaves', () => {
  it('lists the open steps under a stage rather than the stage, and leaves out closed steps and rhythms', () => {
    const tree = [
      node('stage', {
        children: [node('a', { status: 'done' }), node('b'), node('c', { status: 'blocked' })],
      }),
      node('d', { status: 'dropped' }),
      node('r', { kind: 'rhythm' }),
      node('e', { children: [node('e1', { status: 'done' })] }),
    ];
    expect(openLeaves(tree).map((n) => n.id)).toEqual(['b', 'c', 'e']);
  });
});

describe('goalStrip', () => {
  it('puts what is on you first under Now, the next step that can start under Next, and the rest under Later', () => {
    const strip = goalStrip(
      [
        node('q', { kind: 'decision', title: 'Which card first?' }),
        node('later', { title: 'Send extra payments', waitsUntil: '2026-12-18' }),
        node('next', { title: 'Turn on autopay', kind: 'claude', dueOn: '2026-12-18' }),
        node('after', { title: 'Recertify income' }),
      ],
      [answer],
    );
    expect(strip.now).toEqual({
      id: 'q',
      title: 'Which card first?',
      line: 'Answer',
      href: '?tab=plan#step-q',
      canClose: false,
    });
    expect(strip.next).toEqual({
      id: 'next',
      title: 'Turn on autopay',
      line: 'Dash’s · by 18 Dec',
      href: '?tab=plan#step-next',
    });
    expect(strip.later).toMatchObject({ id: 'later', line: 'From 18 Dec' });
    expect(strip.laterMore).toBe(1);
  });

  it('says what a later step waits on: another step, or its block', () => {
    const waiting = goalStrip(
      [node('n'), node('w', { waitingOn: [{ id: 'n', title: 'Apply', status: 'open' }] })],
      [],
    );
    expect(waiting.later?.line).toBe('After “Apply”');
    const blocked = goalStrip(
      [node('n'), node('b', { status: 'blocked', blockAsk: 'The approval letter' })],
      [],
    );
    expect(blocked.later?.line).toBe('Needs the approval letter');
  });

  it('is empty for a goal with no open steps', () => {
    expect(goalStrip([node('a', { status: 'done' })], [])).toEqual({
      now: null,
      next: null,
      later: null,
      laterMore: 0,
    });
  });
});
