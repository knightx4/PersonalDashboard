import { describe, expect, it } from 'vitest';
import { goalStrip } from './goal-strip';
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

describe('goalStrip', () => {
  it('names the first of each lane on the Plan tab: a question under Now, the next step that can start under Next, the rest under Later', () => {
    const strip = goalStrip(
      [
        node('q', { kind: 'decision', title: 'Which card first?' }),
        node('later', { title: 'Send extra payments', waitsUntil: '2026-12-18' }),
        node('next', { title: 'Turn on autopay', kind: 'claude', dueOn: '2026-12-18' }),
        node('after', {
          title: 'Recertify income',
          waitingOn: [{ id: 'next', title: 'Turn on autopay', status: 'open' }],
        }),
      ],
      [answer],
    );
    expect(strip.now).toEqual({
      id: 'q',
      title: 'Which card first?',
      line: null,
      href: '?tab=plan#step-q',
      canClose: false,
      action: 'Answer',
    });
    expect(strip.next).toEqual({
      id: 'next',
      title: 'Turn on autopay',
      line: 'Dash’s · by 18 Dec',
      href: '?tab=plan#step-next',
    });
    expect(strip.later).toMatchObject({ id: 'later', line: 'Starts 18 Dec' });
    expect(strip.laterMore).toBe(1);
  });

  it('says what a later step waits on: another step, or its block', () => {
    const waiting = goalStrip(
      [node('n'), node('w', { waitingOn: [{ id: 'n', title: 'Apply', status: 'open' }] })],
      [],
    );
    expect(waiting.later?.line).toBe('After step 1');
    const blocked = goalStrip(
      [node('n'), node('b', { status: 'blocked', blockAsk: 'The approval letter' })],
      [],
    );
    expect(blocked.later?.line).toBe('The approval letter');
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
