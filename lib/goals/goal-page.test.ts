import { describe, expect, it } from 'vitest';
import {
  firstSentence,
  goalFindings,
  goalStages,
  rhythmSteps,
  stageMeta,
  stagesLabel,
} from './goal-page';
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

  it('opens every stage with work started, not only the first', () => {
    const stages = goalStages([
      node('target', { children: [node('t1', { status: 'done' }), node('t2')] }),
      node('resume', { children: [node('r1')] }),
      node('network', { children: [node('n1', { result: 'Found three people.' }), node('n2')] }),
    ])!;
    expect(stages.map((s) => s.state)).toEqual(['current', 'later', 'current']);
  });

  it('reads a stage held by a step in another stage as waiting on it', () => {
    const r1 = node('r1');
    const stages = goalStages([
      node('resume', { children: [r1] }),
      node('apply', {
        children: [
          node('a1', { status: 'done' }),
          node('a2', { waitingOn: [{ id: 'r1', title: 'r1', status: 'open' }] }),
        ],
      }),
    ])!;
    expect(stages.map((s) => [s.state, s.waitsOn])).toEqual([
      ['current', []],
      ['waiting', [1]],
    ]);
    expect(stageMeta(stages[1])).toBe('1 of 2 done · waiting on stage 1');
  });

  it('is not held while one open step in it is free to move', () => {
    const stages = goalStages([
      node('resume', { children: [node('r1')] }),
      node('apply', {
        children: [
          node('a1', { waitingOn: [{ id: 'r1', title: 'r1', status: 'open' }] }),
          node('a2', { status: 'done' }),
          node('a3'),
        ],
      }),
    ])!;
    expect(stages[1].state).toBe('current');
  });

  it('opens the first held stage when every stage left is held', () => {
    const outside = [{ id: 'elsewhere', title: 'x', status: 'open' as const }];
    const stages = goalStages([
      node('a', { waitingOn: outside, children: [node('a1', { waitingOn: outside })] }),
      node('b', { waitingOn: outside, children: [node('b1', { waitingOn: outside })] }),
    ])!;
    expect(stages.map((s) => s.state)).toEqual(['current', 'waiting']);
    expect(stages[1].waitsElsewhere).toBe(true);
    expect(stageMeta(stages[1])).toBe('1 step · waiting on another step');
  });
});

describe('stagesLabel', () => {
  const at = (state: 'done' | 'current' | 'waiting' | 'later', index: number) => ({ state, index });
  it('names the stages under way', () => {
    expect(stagesLabel([at('current', 1), at('later', 2)])).toBe('Stage 1 of 2');
    expect(stagesLabel([at('current', 1), at('waiting', 2), at('current', 3)])).toBe('Stages 1 and 3 of 3');
    expect(stagesLabel([at('done', 1), at('done', 2)])).toBe('All 2 stages done');
  });
});

describe('stageMeta', () => {
  it('says done, a count done, or how many steps', () => {
    const free = { waitsOn: [], waitsElsewhere: false };
    expect(stageMeta({ state: 'done', done: 3, live: 3, ...free })).toBe('done');
    expect(stageMeta({ state: 'current', done: 2, live: 5, ...free })).toBe('2 of 5 done');
    expect(stageMeta({ state: 'later', done: 0, live: 1, ...free })).toBe('1 step');
    expect(stageMeta({ state: 'later', done: 0, live: 4, ...free })).toBe('4 steps');
    expect(stageMeta({ state: 'waiting', done: 0, live: 2, waitsOn: [2, 4], waitsElsewhere: false })).toBe(
      '2 steps · waiting on stages 2 and 4',
    );
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
