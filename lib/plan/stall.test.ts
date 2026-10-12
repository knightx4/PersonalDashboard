/**
 * A feature whose last two runs closed nothing is raised once, with the cause
 * when the sessions gave one, and held from the runner until it is sent again.
 */
import { describe, expect, it } from 'vitest';
import {
  featureSteps,
  isStalled,
  SPLIT_ACTION,
  splitPieces,
  stallRunIds,
  raiseFeatureId,
  raiseHolds,
  runsByFeature,
  shouldRaiseStall,
  stallRaise,
  stuckStep,
  isRunnerSource,
  type FeatureRaise,
  type StallRun,
} from './stall';

function run(over: Partial<StallRun> & { id: string; createdAt: string }): StallRun {
  return {
    planItemId: 'step',
    status: 'failed',
    stopReason: null,
    stopPieces: null,
    error: null,
    ...over,
  };
}

const NEWER = run({ id: 'r2', createdAt: '2026-10-11T10:00:00.000Z' });
const OLDER = run({ id: 'r1', createdAt: '2026-10-10T10:00:00.000Z' });
const FEATURE = { id: 'f1', number: 1801, title: 'Raise a stalled feature', module: 'dev' };

describe('runsByFeature', () => {
  it('keeps the two newest runs under each feature, newest first', () => {
    const runs = [
      run({ id: 'a', planItemId: 'step', createdAt: '2026-10-09T00:00:00.000Z' }),
      run({ id: 'b', planItemId: 'f1', createdAt: '2026-10-11T00:00:00.000Z' }),
      run({ id: 'c', planItemId: 'step', createdAt: '2026-10-10T00:00:00.000Z' }),
      run({ id: 'd', planItemId: 'elsewhere', createdAt: '2026-10-12T00:00:00.000Z' }),
    ];
    const byFeature = runsByFeature(runs, (id) => (id === 'elsewhere' ? null : 'f1'));
    expect(byFeature.get('f1')?.map((one) => one.id)).toEqual(['b', 'c']);
    expect(byFeature.size).toBe(1);
  });
});

describe('isStalled', () => {
  it('is two failed runs in a row', () => {
    expect(isStalled([NEWER, OLDER])).toBe(true);
  });

  it('is not a run that closed or blocked a step, nor one still going', () => {
    expect(isStalled([NEWER, { ...OLDER, status: 'finished' }])).toBe(false);
    expect(isStalled([{ ...NEWER, status: 'started' }, OLDER])).toBe(false);
  });

  it('is not one run on its own', () => {
    expect(isStalled([NEWER])).toBe(false);
  });
});

describe('shouldRaiseStall', () => {
  const raise = (over: Partial<FeatureRaise>): FeatureRaise => ({
    status: 'open',
    createdAt: '2026-10-11T11:00:00.000Z',
    answeredAt: null,
    ...over,
  });

  it('raises a stall nothing has been filed about', () => {
    expect(shouldRaiseStall([NEWER, OLDER], [])).toBe(true);
  });

  it('adds no second raise while one is open, whenever it was filed', () => {
    const third = run({ id: 'r3', createdAt: '2026-10-12T10:00:00.000Z' });
    expect(
      shouldRaiseStall([third, NEWER], [raise({ createdAt: '2026-10-11T11:00:00.000Z' })]),
    ).toBe(false);
  });

  it('raises nothing again for a stall already answered', () => {
    expect(
      shouldRaiseStall(
        [NEWER, OLDER],
        [raise({ status: 'answered', answeredAt: '2026-10-11T12:00:00.000Z' })],
      ),
    ).toBe(false);
  });

  it('raises a new stall after the last raise was answered and the feature sent again', () => {
    const third = run({ id: 'r3', createdAt: '2026-10-12T10:00:00.000Z' });
    expect(
      shouldRaiseStall(
        [third, NEWER],
        [raise({ status: 'answered', answeredAt: '2026-10-11T12:00:00.000Z' })],
      ),
    ).toBe(true);
  });
});

describe('raiseHolds', () => {
  it('holds a feature while its raise is open', () => {
    expect(raiseHolds([{ status: 'open', createdAt: '2026-10-11T11:00:00.000Z', answeredAt: null }], NEWER.createdAt)).toBe(true);
  });

  it('holds it after a No, until it is sent again', () => {
    const no: FeatureRaise = {
      status: 'answered',
      createdAt: '2026-10-11T11:00:00.000Z',
      answeredAt: '2026-10-11T12:00:00.000Z',
    };
    expect(raiseHolds([no], NEWER.createdAt)).toBe(true);
    expect(raiseHolds([no], '2026-10-11T12:00:05.000Z')).toBe(false);
  });

  it('holds nothing once dismissed, or with no raise', () => {
    expect(
      raiseHolds([{ status: 'dismissed', createdAt: '2026-10-11T11:00:00.000Z', answeredAt: null }], null),
    ).toBe(false);
    expect(raiseHolds([], null)).toBe(false);
  });
});

describe('raiseFeatureId', () => {
  it('reads the feature from either kind of held raise', () => {
    expect(raiseFeatureId('overnight held f1 after 2026-10-11T10:00:00Z')).toBe('f1');
    expect(raiseFeatureId('stalled f1 runs r2 r1')).toBe('f1');
    expect(raiseFeatureId('plan #12')).toBeNull();
    expect(raiseFeatureId(null)).toBeNull();
  });
});

describe('stuckStep', () => {
  it('names the first build step not yet done or dropped', () => {
    expect(
      stuckStep({
        children: [
          { kind: 'build', status: 'done', number: 1, title: 'Done' },
          { kind: 'decision', status: 'not_started', number: 2, title: 'A question' },
          { kind: 'build', status: 'dropped', number: 3, title: 'Dropped' },
          { kind: 'build', status: 'in_progress', number: 4, title: 'Tune it from two weeks of undos' },
        ],
      }),
    ).toEqual({ number: 4, title: 'Tune it from two weeks of undos' });
    expect(stuckStep({ children: [] })).toBeNull();
  });
});

describe('isRunnerSource', () => {
  it('tells the runner id sources from a readable one', () => {
    expect(isRunnerSource('stalled f1 runs r2 r1')).toBe(true);
    expect(isRunnerSource('overnight held f1 after 2026-10-11T10:00:00Z')).toBe(true);
    expect(isRunnerSource('plan #12')).toBe(false);
    expect(isRunnerSource(null)).toBe(false);
  });
});

describe('stallRaise', () => {
  it('says what each session ended with and names the step it is stuck on', () => {
    const raise = stallRaise(
      FEATURE,
      [
        { ...NEWER, error: 'Nothing was pushed in the 32m after this run started.' },
        OLDER,
      ],
      5,
      { number: 1135, title: 'Tune which evidence closes a step from two weeks of undos' },
    );
    expect(raise.detail).toContain(
      '- 2026-10-11: the session left no note. Nothing was pushed in the 32m after this run started.',
    );
    expect(raise.detail).toContain(
      'The step it is stuck on is #1135 Tune which evidence closes a step from two weeks of undos.',
    );
    expect(raise.detail).not.toContain('neither said why');
  });

  it('asks to send it again when neither session said why', () => {
    const raise = stallRaise(FEATURE, [NEWER, OLDER], 0);
    expect(raise.title).toBe('#1801 Raise a stalled feature: two sessions in a row finished nothing');
    expect(raise.ask).toBe('Try #1801 Raise a stalled feature again?');
    expect(raise.consequence).toMatchObject({ name: 'send_step', text: '#1801' });
    expect(raise.source).toBe('stalled f1 runs r2 r1');
  });

  it('quotes the line each session wrote, and asks about the cause', () => {
    const raise = stallRaise(FEATURE, [
      { ...NEWER, stopReason: 'Main was red from another merge.' },
      { ...OLDER, error: 'Nothing was heard from this run for 2h.' },
    ], 0);
    expect(raise.ask).toBe(
      'A session on it stopped because "Main was red from another merge". Send #1801 Raise a stalled feature again as it stands?',
    );
    expect(raise.detail).toContain('- 2026-10-11: "Main was red from another merge."');
    expect(raise.detail).toContain(
      '- 2026-10-10: the session left no note. Nothing was heard from this run for 2h.',
    );
    expect(raise.consequence.name).toBe('send_step');
  });

  const TOO_BIG = [
    {
      ...NEWER,
      stopReason: 'Too big for one sitting.',
      stopPieces: ['Read the runs', 'Write the raise', 'Hold on No'],
    },
    OLDER,
  ];

  it('asks to split a feature with no steps into the pieces, and the Yes splits it', () => {
    const raise = stallRaise(FEATURE, TOO_BIG, 0);
    expect(raise.ask).toBe('Split #1801 Raise a stalled feature into 3 steps?');
    expect(raise.detail).toMatch(/^This covers 3 pieces of work\. /);
    expect(raise.detail).toContain('1. Read the runs\n2. Write the raise\n3. Hold on No');
    expect(raise.detail).toContain('Yes writes them as steps under it, ready to build, and sends the first.');
    expect(raise.consequence).toMatchObject({ name: SPLIT_ACTION, text: '#1801' });
    expect(raise.source).toBe('stalled f1 runs r2 r1');
  });

  it('lists the pieces but asks to send again when the feature already has steps', () => {
    const raise = stallRaise(FEATURE, TOO_BIG, 2);
    expect(raise.ask).toBe(
      'The sessions found #1801 Raise a stalled feature too big for one sitting and would split it into 3 steps. Send it again as it stands?',
    );
    expect(raise.detail).toContain('1. Read the runs\n2. Write the raise\n3. Hold on No');
    expect(raise.consequence.name).toBe('send_step');
  });

  it('keeps "send it again?" with no reason, even for a feature with no steps', () => {
    expect(stallRaise(FEATURE, [NEWER, OLDER], 0).consequence.name).toBe('send_step');
  });

  it('keeps the ask inside the column with the longest reason and title', () => {
    for (const raise of [
      stallRaise({ ...FEATURE, title: 'x'.repeat(200) }, [{ ...NEWER, stopReason: 'y'.repeat(300) }, OLDER], 0),
      stallRaise(
        { ...FEATURE, title: 'x'.repeat(200) },
        [{ ...NEWER, stopReason: 'y'.repeat(300), stopPieces: Array(20).fill('z'.repeat(200)) }, OLDER],
        0,
      ),
    ]) {
      expect(raise.ask.length).toBeLessThanOrEqual(500);
      expect(raise.title.length).toBeLessThanOrEqual(200);
      expect(raise.detail.length).toBeLessThanOrEqual(4000);
      expect(raise.source.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('featureSteps', () => {
  it('counts the build rows beneath, leaving out dropped ones, questions and setup jobs', () => {
    expect(
      featureSteps({
        children: [
          { kind: 'build', status: 'not_started' },
          { kind: 'build', status: 'done' },
          { kind: 'build', status: 'dropped' },
          { kind: 'decision', status: 'proposed' },
          { kind: 'setup', status: 'not_started' },
        ],
      }),
    ).toBe(2);
    expect(featureSteps({ children: [] })).toBe(0);
  });
});

describe('stallRunIds', () => {
  it('reads the runs a stall raise names, newest first', () => {
    expect(stallRunIds('stalled f1 runs r2 r1')).toEqual(['r2', 'r1']);
    expect(stallRunIds('overnight held f1 after 2026-10-11T10:00:00Z')).toEqual([]);
    expect(stallRunIds(null)).toEqual([]);
  });
});

describe('splitPieces', () => {
  it('takes the pieces of the first run named that left any, with its session', () => {
    const found = splitPieces(
      ['r2', 'r1'],
      [
        { id: 'r1', stopPieces: ['Older one', 'Older two'], session: 'cse_old' },
        { id: 'r2', stopPieces: [' Read the runs ', 'Write the raise'], session: 'cse_new' },
      ],
    );
    expect(found).toEqual({ pieces: ['Read the runs', 'Write the raise'], session: 'cse_new' });
  });

  it('falls back to the older run, and is null when neither left two pieces', () => {
    const older = { id: 'r1', stopPieces: ['One', 'Two'], session: null };
    expect(splitPieces(['r2', 'r1'], [{ id: 'r2', stopPieces: null, session: 'x' }, older])).toEqual({
      pieces: ['One', 'Two'],
      session: null,
    });
    expect(splitPieces(['r2'], [{ id: 'r2', stopPieces: ['Only one'], session: null }])).toBeNull();
    expect(splitPieces([], [older])).toBeNull();
  });
});
