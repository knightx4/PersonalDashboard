import { describe, expect, it } from 'vitest';
import {
  checkDigest,
  checkLectures,
  clock,
  digestTotals,
  linkMoments,
  momentsIn,
  secondsOf,
  type Lecture,
} from './digest';
import { afterStep, isOpen, mapLayout, nextStep } from './plan';

const LECTURES: Lecture[] = [
  {
    code: 'L07',
    title: 'Value At Risk',
    videoId: '92WaNz9mPeY',
    durationSeconds: 4875,
    speaker: 'Ken Abbott',
  },
  {
    code: 'L11',
    title: 'Time Series',
    videoId: '_IFUfFuyQlU',
    durationSeconds: 4800,
    speaker: null,
  },
];

const SVG =
  '<svg viewBox="0 0 360 80" role="img" aria-label="Loss against sigma"><line x1="10" y1="60" x2="350" y2="60" stroke="currentColor"/><text x="10" y="20" font-size="12" class="accent">2.33 sigma</text></svg>';

// Commentary long enough to make a step a sitting on its own: about five minutes of reading.
const WORDS = Array.from({ length: 1150 }, () => 'word').join(' ');
const step = (title: string, blocks: unknown[] = []) => ({
  title,
  gain: 'Work the number out and say what it leaves out.',
  blocks: [{ type: 'text', body: WORDS }, ...blocks],
});

function digest(overrides: Record<string, unknown> = {}, stages?: unknown[]) {
  return {
    madeFor: 'A CPA who knows regression.',
    intro: 'Two lectures, read in full. See [[L07 21:49]].',
    plan: {
      intro: 'Shared ground, then two branches.',
      budgetMinutes: 30,
      stages: stages ?? [
        {
          key: 'A',
          short: 'Shared ground',
          title: 'Shared ground',
          about: 'What both branches rest on.',
          after: [],
          steps: [
            step('Value at Risk', [
              {
                type: 'clip',
                code: 'L07',
                start: '21:49',
                end: '29:39',
                listenFor: 'The backtest.',
              },
              {
                type: 'text',
                title: 'Worked',
                body: 'Daily sigma of 1.8% times 2.33 gives 4.2% [[L07 21:49-29:39]].',
              },
              { type: 'figure', caption: 'Where the 99% line falls.', svg: SVG },
              { type: 'check', question: 'Work the VaR on $10M.', answer: '$420K.' },
            ]),
            step('Fat tails'),
          ],
        },
        {
          key: 'B',
          short: 'Risk',
          title: 'Risk',
          about: 'Measuring it.',
          after: ['A'],
          steps: [step('Backtesting')],
        },
        {
          key: 'C',
          short: 'Time series',
          title: 'Time series',
          about: 'Modelling it.',
          after: ['A'],
          steps: [
            step('Volatility clusters', [
              {
                type: 'reading',
                title: 'Lecture 9 notes',
                author: 'Peter Kempthorne',
                source: 'MIT OpenCourseWare',
                url: 'https://ocw.mit.edu/courses/18-s096/',
                body: 'The derivation the lecture skips.',
                excerpt: ['Volatility is not observed directly.'],
                licence: 'CC BY-NC-SA 4.0',
              },
            ]),
          ],
        },
        {
          key: 'D',
          short: 'Putting it together',
          title: 'Putting it together',
          about: 'Needs both.',
          after: ['B', 'C'],
          steps: [step('A desk')],
        },
      ],
    },
    ratings: {
      intro: '',
      rows: [
        {
          code: 'L07',
          rating: 'watch',
          watch: '[[L07 21:49-29:39]]',
          why: 'The practitioner view.',
        },
        { code: 'L11', rating: 'skim', watch: '', why: 'Known material.' },
      ],
    },
    ideas: Array.from({ length: 5 }, (_, index) => ({
      title: `Idea ${index + 1}`,
      body: 'With its example.',
    })),
    errors: {
      intro: '',
      rows: [
        { where: '[[L07 24:55]]', said: '3 sigma once per 10,000.', correction: 'About 1 in 740.' },
      ],
    },
    ...overrides,
  };
}

describe('moments', () => {
  it('reads clock times as seconds and back', () => {
    expect(secondsOf('21:49')).toBe(1309);
    expect(secondsOf('1:21:15')).toBe(4875);
    expect(secondsOf('soon')).toBeNull();
    expect(clock(1309)).toBe('21:49');
    expect(clock(4875)).toBe('1:21:15');
  });

  it('finds tokens with and without an end', () => {
    expect(momentsIn('See [[L07 21:49]] and [[L11 19:32-22:36]].')).toEqual([
      { code: 'L07', start: 1309, end: null, raw: '[[L07 21:49]]' },
      { code: 'L11', start: 1172, end: 1356, raw: '[[L11 19:32-22:36]]' },
    ]);
  });

  it('builds each link from the stored video id', () => {
    expect(linkMoments('See [[L07 21:49]].', LECTURES)).toBe(
      'See [L07 21:49](https://www.youtube.com/watch?v=92WaNz9mPeY&t=1309).',
    );
    expect(linkMoments('[[L07 21:49-29:39]]', LECTURES)).toContain('[L07 21:49 to 29:39]');
    expect(linkMoments('See [[X01 1:00]].', LECTURES)).toBe('See X01 1:00.');
    // The pages pass their own player in place of YouTube.
    expect(
      linkMoments(
        '[[L07 21:49]]',
        LECTURES,
        (lecture, start) => `/c?play=${lecture.code}&t=${start}`,
      ),
    ).toBe('[L07 21:49](/c?play=L07&t=1309)');
  });
});

describe('checkDigest', () => {
  it('keeps a plan that checks, and works out each step\u2019s minutes itself', () => {
    const checked = checkDigest(digest(), LECTURES);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const [first] = checked.digest.plan.stages[0].steps;
    expect(first).toMatchObject({ key: 'A.1', minutes: 13 });
    expect(first.gain).toBe('Work the number out and say what it leaves out.');
    expect(checked.digest.plan.stages[0].short).toBe('Shared ground');
    expect(first.blocks[1]).toMatchObject({ type: 'clip', start: 1309, end: 1779, minutes: 8 });
    expect(digestTotals(checked.digest, LECTURES)).toMatchObject({
      watchMinutes: 8,
      stages: 4,
      steps: 5,
      watch: 1,
      skim: 1,
    });
  });

  const failing: [string, Record<string, unknown>, RegExp][] = [
    [
      'a time past the end of the lecture',
      { intro: 'See [[L07 1:30:00]].' },
      /past the end of L07/,
    ],
    [
      'a lecture the course lacks',
      { intro: 'See [[L99 1:00]].' },
      /L99, which the course does not have/,
    ],
    [
      'a typed link',
      { intro: 'See https://www.youtube.com/watch?v=92WaNz9mPeY.' },
      /typed YouTube link/,
    ],
    ['an em dash', { madeFor: 'A CPA \u2014 and an MBA.' }, /em dash/],
    ['too few big ideas', { ideas: [] }, /big ideas/],
    ['a plan with nothing in it', { plan: { stages: [] } }, /no stages/],
  ];
  it.each(failing)('refuses %s', (_name, overrides, problem) => {
    const checked = checkDigest(digest(overrides), LECTURES);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(problem);
  });

  const stage = (over: Record<string, unknown>, blocks: unknown[] = []) => [
    {
      key: 'A',
      short: 'Start',
      title: 'Start',
      about: 'x',
      after: [],
      steps: [step('One', blocks)],
      ...over,
    },
  ];
  const badPlans: [string, unknown[], RegExp][] = [
    [
      'a stage that comes after one below it',
      [
        ...stage({}),
        { key: 'B', short: 'b', title: 'b', about: 'x', after: ['C'], steps: [step('s')] },
      ],
      /not a stage above it/,
    ],
    [
      'a second stage that comes after nothing',
      [
        ...stage({}),
        { key: 'B', short: 'b', title: 'b', about: 'x', after: [], steps: [step('s')] },
      ],
      /only the first stage starts/,
    ],
    [
      'a step with no commentary',
      stage({
        steps: [{ title: 'Bare', blocks: [{ type: 'check', question: 'q', answer: 'a' }] }],
      }),
      /no commentary/,
    ],
    [
      'a step too short to be a sitting',
      stage({
        steps: [{ title: 'A note', gain: 'g', blocks: [{ type: 'text', body: 'One line.' }] }],
      }),
      /too short to be a sitting/,
    ],
    [
      'a step that does not say what you get',
      stage({ steps: [{ title: 'One', blocks: [{ type: 'text', body: WORDS }] }] }),
      /gain is empty/,
    ],
    [
      'a stage with no name for the map',
      [{ key: 'A', title: 'Start', about: 'x', after: [], steps: [step('One')] }],
      /short name is empty/,
    ],
    [
      'prose that points at a stage by its key',
      stage({ about: 'Take this before stage A.' }),
      /call a stage or a step by its title/,
    ],
    [
      'prose that points at a step by its key',
      stage({}, [{ type: 'text', body: 'As A.2 showed.' }]),
      /names "A\.2"/,
    ],
    [
      'a clip with no end',
      stage({}, [{ type: 'clip', code: 'L07', start: '21:49', listenFor: 'x' }]),
      /clip with no end/,
    ],
    [
      'clips over the budget',
      stage({}, [{ type: 'clip', code: 'L07', start: '0:10', end: '1:10:00', listenFor: 'x' }]),
      /against a budget of 30/,
    ],
    [
      'a drawing with a colour of its own',
      stage({}, [
        {
          type: 'figure',
          caption: 'c',
          svg: '<svg viewBox="0 0 10 10"><rect fill="#ff0000" width="1" height="1"/></svg>',
        },
      ]),
      /colour of its own/,
    ],
    [
      'an excerpt with no licence named',
      stage({}, [{ type: 'reading', title: 't', body: 'b', excerpt: ['The text.'] }]),
      /without naming its open licence/,
    ],
    [
      'a reading that links a video',
      stage({}, [{ type: 'reading', title: 't', body: 'b', url: 'https://youtu.be/92WaNz9mPeY' }]),
      /links a video/,
    ],
  ];
  it.each(badPlans)('refuses %s', (_name, stages, problem) => {
    const checked = checkDigest(digest({}, stages), LECTURES);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(problem);
  });

  it('refuses a lecture left without a rating (D4)', () => {
    const base = digest();
    const checked = checkDigest({ ...base, ratings: { rows: [base.ratings.rows[0]] } }, LECTURES);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(/L11 has no rating/);
  });
});

describe('walking the plan', () => {
  const checked = checkDigest(digest(), LECTURES);
  if (!checked.ok) throw new Error(checked.problems.join(' '));
  const plan = checked.digest.plan;
  const done = (...keys: string[]) => new Set(keys);

  const places = (layout: ReturnType<typeof mapLayout>) =>
    Object.fromEntries(layout.nodes.map((node) => [node.key, [node.x, node.row]]));

  it('sets branches side by side under the stage they follow, and what needs both below them', () => {
    const layout = mapLayout(plan);
    expect(places(layout)).toEqual({ A: [0.5, 0], B: [0, 1], C: [1, 1], D: [0, 2] });
    expect(layout).toMatchObject({ columns: 2, rows: 3 });
    expect(layout.edges).toContainEqual({ from: 'C', to: 'D' });
  });

  it('keeps a branch in its own column and centres a stage over its fork', () => {
    const bare = (key: string, after: string[]) => ({
      key,
      short: key,
      title: key,
      about: 'x',
      after,
      steps: [step('s')],
    });
    const long = checkDigest(
      digest({}, [
        bare('A', []),
        bare('B1', ['A']),
        bare('B2', ['B1']),
        bare('B3', ['B1']),
        bare('C1', ['A']),
        bare('C2', ['C1']),
      ]),
      LECTURES,
    );
    if (!long.ok) throw new Error(long.problems.join(' '));
    expect(places(mapLayout(long.digest.plan))).toEqual({
      A: [1.25, 0],
      B1: [0.5, 1],
      B2: [0, 2],
      B3: [1, 2],
      C1: [2, 1],
      C2: [2, 2],
    });
  });

  it('starts at the first stage and follows a branch once it is begun', () => {
    expect(nextStep(plan, done())?.step.key).toBe('A.1');
    expect(nextStep(plan, done('A.1'))?.step.key).toBe('A.2');
    // Both branches are open after A; the first is offered until the other is begun.
    expect(nextStep(plan, done('A.1', 'A.2'))?.step.key).toBe('B.1');
    expect(nextStep(plan, done('A.1', 'A.2', 'B.1'))?.step.key).toBe('C.1');
    expect(nextStep(plan, done('A.1', 'A.2', 'B.1', 'C.1'))?.step.key).toBe('D.1');
    expect(nextStep(plan, done('A.1', 'A.2', 'B.1', 'C.1', 'D.1'))).toBeNull();
  });

  it('opens a stage only when every stage before it is finished', () => {
    const last = plan.stages[3];
    expect(isOpen(plan, last, done('A.1', 'A.2', 'B.1'))).toBe(false);
    expect(isOpen(plan, last, done('A.1', 'A.2', 'B.1', 'C.1'))).toBe(true);
  });

  it('offers the branches at the end of a stage', () => {
    expect(afterStep(plan, 'A.1')).toMatchObject({ step: { key: 'A.2' }, stages: [] });
    expect(afterStep(plan, 'A.2').stages.map((item) => item.key)).toEqual(['B', 'C']);
    expect(afterStep(plan, 'D.1')).toEqual({ step: null, stages: [] });
  });
});

describe('checkLectures', () => {
  it('reads lengths given as clock times', () => {
    const checked = checkLectures([
      { code: 'L07', title: 'VaR', videoId: '92WaNz9mPeY', durationSeconds: '1:21:15' },
    ]);
    expect(checked).toEqual({
      ok: true,
      lectures: [
        { code: 'L07', title: 'VaR', videoId: '92WaNz9mPeY', durationSeconds: 4875, speaker: null },
      ],
    });
  });

  it('refuses a repeated code or a missing video id', () => {
    const checked = checkLectures([
      { code: 'L07', title: 'a', videoId: '92WaNz9mPeY', durationSeconds: 60 },
      { code: 'L07', title: 'b', videoId: 'nope', durationSeconds: 60 },
    ]);
    expect(checked.ok).toBe(false);
  });
});
