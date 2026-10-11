import { describe, expect, it } from 'vitest';
import {
  closedSteps,
  firstSentence,
  isStepAnchor,
  stepAnchor,
  goalStages,
  nowLabel,
  nowStages,
  rhythmSteps,
  stageMeta,
  stagesLabel,
  stepPreps,
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

describe('nowStages', () => {
  const stage = (id: string, children: StepNode[], extra: Partial<StepNode> = {}) =>
    node(id, { children: children.map((child) => ({ ...child, parentId: id })), ...extra });
  const open = (steps: StepNode[]) => [...nowStages(goalStages(steps), steps)];

  it('is empty for a goal that is one list', () => {
    expect(open([node('a'), node('b')])).toEqual([]);
  });

  it('opens the first stage neither finished nor held, and no other with nothing on you', () => {
    const steps = [
      stage('done', [node('d1', { status: 'done' })]),
      stage('target', [node('t1', { kind: 'claude' })]),
      // Under way, with Dash's work started, but nothing waiting on you.
      stage('network', [node('n1', { kind: 'claude', status: 'done', reviewedAt: '2026-10-01' }), node('n2', { kind: 'claude' })]),
    ];
    expect(open(steps)).toEqual(['target']);
  });

  it('opens a later stage with a step of yours that is ready', () => {
    const steps = [
      stage('target', [node('t1', { kind: 'claude' })]),
      stage('resume', [node('r1', { kind: 'claude' })]),
      stage('apply', [node('a1')]),
    ];
    expect(open(steps)).toEqual(['target', 'apply']);
  });

  it('opens a stage holding a question, a proposal or a result to read', () => {
    const steps = [
      stage('target', [node('t1', { kind: 'claude' })]),
      stage('ask', [node('q1', { kind: 'decision' })]),
      stage('proposed', [node('p1', { kind: 'claude', status: 'proposed' })]),
      stage('read', [node('x1', { kind: 'claude', status: 'done', result: 'Found it.' })], { status: 'done' }),
      stage('aside', [node('q2', { kind: 'decision', dismissedAt: '2026-10-01' }), node('c2', { kind: 'claude' })]),
    ];
    expect(open(steps)).toEqual(['target', 'ask', 'proposed', 'read']);
  });

  it('leaves a stage whose step of yours is waiting on another step on the map', () => {
    const steps = [
      stage('target', [node('t1', { kind: 'claude' })]),
      stage('apply', [node('a1', { waitingOn: [{ id: 't1', title: 't1', status: 'open' }] })]),
    ];
    expect(open(steps)).toEqual(['target']);
  });

  it('names the stages it opened', () => {
    const stages = [
      { id: 'a', index: 1 },
      { id: 'b', index: 2 },
      { id: 'c', index: 3 },
    ];
    expect(nowLabel(stages, new Set(['b']))).toBe('Stage 2 of 3');
    expect(nowLabel(stages, new Set(['a', 'c']))).toBe('Stages 1 and 3 of 3');
    expect(nowLabel(stages, new Set())).toBeNull();
  });
});

describe('stepPreps', () => {
  const apply = node('apply', { title: 'Apply to Kroll' });
  const prep = (extra: Partial<StepNode> = {}) =>
    node('prep', { kind: 'claude', title: 'Draft the Kroll cover letter', preparesId: 'apply', ...extra });

  it('says an open prep step is preparing, by its title, and names the step it is for', () => {
    const { prepFor, targetOf } = stepPreps([[prep(), apply]]);
    expect(prepFor.apply).toEqual({
      id: 'prep',
      title: 'Draft the Kroll cover letter',
      done: false,
      line: null,
      result: null,
      resultUrl: null,
      unread: false,
    });
    expect(targetOf.prep).toEqual({ id: 'apply', title: 'Apply to Kroll' });
  });

  it('gives a done prep step the first sentence of what it produced', () => {
    const { prepFor } = stepPreps([
      [prep({ status: 'done', result: '## Draft\n\nA letter leading on the fraud work. Second sentence.' }), apply],
    ]);
    expect(prepFor.apply).toMatchObject({
      done: true,
      line: 'A letter leading on the fraud work.',
      result: '## Draft\n\nA letter leading on the fraud work. Second sentence.',
      unread: true,
    });
  });

  it('shows nothing for a dropped prep step, or on a step with none', () => {
    const { prepFor, targetOf } = stepPreps([[prep({ status: 'dropped' }), apply, node('other')]]);
    expect(prepFor).toEqual({});
    expect(targetOf).toEqual({});
  });

  it('finds a prep step nested under a stage and a target in a linked tree', () => {
    const { prepFor } = stepPreps([[node('stage', { children: [prep()] })], [apply]]);
    expect(prepFor.apply?.id).toBe('prep');
  });

  it('ignores prepares_id on a step that is not Dash\'s', () => {
    expect(stepPreps([[node('x', { preparesId: 'apply' }), apply]]).prepFor).toEqual({});
  });
});

describe('the goal page tabs', () => {
  it('sends a link to a step to its row on the Steps tab', () => {
    expect(stepAnchor('s1')).toBe('?tab=steps#step-s1');
    expect(isStepAnchor(stepAnchor('s1'))).toBe(true);
    expect(isStepAnchor('#step-s1')).toBe(true);
    expect(isStepAnchor('#flag-f1')).toBe(false);
  });

  it('lists closed steps at any depth, newest first, leaving out the untimed', () => {
    const steps = [
      node('a', { status: 'done', closedAt: '2026-10-01T09:00:00Z' }),
      node('b', {
        children: [
          node('b1', { status: 'dropped', closedAt: '2026-10-03T09:00:00Z' }),
          node('b2', { status: 'done', kind: 'claude', closedAt: '2026-10-02T09:00:00Z' }),
        ],
      }),
      node('c', { status: 'done', closedAt: null }),
    ];
    expect(closedSteps(steps).map((s) => [s.id, s.status, s.dash])).toEqual([
      ['b1', 'dropped', false],
      ['b2', 'done', true],
      ['a', 'done', false],
    ]);
  });
});
