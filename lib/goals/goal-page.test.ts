import { describe, expect, it } from 'vitest';
import { firstSentence, goalFindings, goalStages, rhythmSteps, stageMeta } from './goal-page';
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

describe('goalStages', () => {
  it('is null for a goal that is one list of steps', () => {
    expect(goalStages([node('a'), node('b', { children: [node('b1')] })])).toBeNull();
  });

  it('opens the first unfinished stage and reads the rest by their own state', () => {
    const stages = goalStages([
      node('target', { children: [node('t1', { status: 'done' }), node('t2'), node('t3', { status: 'dropped' })] }),
      node('resume', { children: [node('r1')] }),
      node('interviews', { status: 'done', children: [node('i1', { status: 'done' })] }),
      node('loose'),
    ])!;
    expect(stages.map((s) => [s.id, s.state, s.done, s.live])).toEqual([
      ['target', 'current', 1, 2],
      ['resume', 'later', 0, 1],
      ['interviews', 'done', 1, 1],
    ]);
    expect(stages.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('reads a stage whose steps are all done as done though the stage is open', () => {
    const stages = goalStages([
      node('a', { children: [node('a1', { status: 'done' })] }),
      node('b', { children: [node('b1')] }),
    ])!;
    expect(stages.map((s) => s.state)).toEqual(['done', 'current']);
  });

  it('leaves a question put aside out of the count', () => {
    const stages = goalStages([
      node('a', { children: [node('a1'), node('q', { kind: 'decision', dismissedAt: '2026-09-01' })] }),
      node('b', { children: [node('b1')] }),
    ])!;
    expect(stages[0].live).toBe(1);
  });
});

describe('stageMeta', () => {
  it('says done, a count done, or how many steps', () => {
    expect(stageMeta({ state: 'done', done: 3, live: 3 })).toBe('done');
    expect(stageMeta({ state: 'current', done: 2, live: 5 })).toBe('2 of 5 done');
    expect(stageMeta({ state: 'later', done: 0, live: 1 })).toBe('1 step');
    expect(stageMeta({ state: 'later', done: 0, live: 4 })).toBe('4 steps');
  });
});

describe('rhythmSteps', () => {
  it('finds live rhythm steps at any depth', () => {
    const rhythm = node('r', { kind: 'rhythm', rhythmCount: 5, rhythmPeriod: 'week' });
    const closed = node('c', { kind: 'rhythm', rhythmCount: 1, rhythmPeriod: 'week', status: 'done' });
    expect(rhythmSteps([node('a', { children: [rhythm, closed] })]).map((s) => s.id)).toEqual(['r']);
  });
});

describe('firstSentence', () => {
  it('takes the first sentence of the first paragraph, without markdown', () => {
    expect(firstSentence('**Floor:** about $118,000 base. Below that, nothing clears.\n\nMore.')).toBe(
      'Floor: about $118,000 base.',
    );
    expect(firstSentence('## Heading\n\n- Array is the strongest fit. It is Series B.')).toBe(
      'Array is the strongest fit.',
    );
  });

  it('does not cut at a stop inside a figure or an abbreviation', () => {
    expect(firstSentence('It pays $118.50 an hour, e.g. more than now. Next.')).toBe(
      'It pays $118.50 an hour, e.g. more than now.',
    );
  });

  it('cuts a long sentence at a word', () => {
    const long = `${'word '.repeat(80)}end.`;
    const fact = firstSentence(long);
    expect(fact.length).toBeLessThanOrEqual(221);
    expect(fact.endsWith('word…')).toBe(true);
  });
});

describe('goalFindings', () => {
  it('lists each step with a result in map order, naming the step', () => {
    const findings = goalFindings([
      node('a', {
        title: 'Know the job',
        children: [
          node('a1', { title: 'Work out the pay floor', kind: 'claude', status: 'done', result: 'Floor: $120k. Detail.' }),
          node('a2', { title: 'Dropped', status: 'dropped', result: 'Gone.' }),
        ],
      }),
      node('b', { title: 'List people', result: 'A starter list. Ten names.', resultUrl: 'https://x' }),
    ]);
    expect(findings).toEqual([
      {
        stepId: 'a1',
        from: 'Work out the pay floor',
        fact: 'Floor: $120k.',
        result: 'Floor: $120k. Detail.',
        url: null,
        unread: true,
      },
      {
        stepId: 'b',
        from: 'List people',
        fact: 'A starter list.',
        result: 'A starter list. Ten names.',
        url: 'https://x',
        unread: false,
      },
    ]);
  });

  it('links a finding to the first place its result points to, and knows when it is read', () => {
    const [finding] = goalFindings([
      node('c', {
        kind: 'claude',
        status: 'done',
        reviewedAt: '2026-09-27T09:00:00Z',
        result: 'Transportation Alternatives is the easiest start. Sign up at transalt.org/volunteer.',
      }),
    ]);
    expect(finding.url).toBe('https://transalt.org/volunteer');
    expect(finding.unread).toBe(false);
  });
});
