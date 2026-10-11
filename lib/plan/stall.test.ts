/**
 * A feature whose last two runs closed nothing is raised once, with the cause
 * when the sessions gave one, and held from the runner until it is sent again.
 */
import { describe, expect, it } from 'vitest';
import {
  isStalled,
  raiseFeatureId,
  raiseHolds,
  runsByFeature,
  shouldRaiseStall,
  stallRaise,
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

describe('stallRaise', () => {
  it('asks to send it again when neither session said why', () => {
    const raise = stallRaise(FEATURE, [NEWER, OLDER]);
    expect(raise.title).toBe('#1801 Raise a stalled feature is held: its last two sessions closed nothing');
    expect(raise.ask).toBe('Send #1801 Raise a stalled feature to a session again?');
    expect(raise.consequence).toMatchObject({ name: 'send_step', text: '#1801' });
    expect(raise.source).toBe('stalled f1 runs r2 r1');
  });

  it('quotes the line each session wrote, and asks about the cause', () => {
    const raise = stallRaise(FEATURE, [
      { ...NEWER, stopReason: 'Main was red from another merge.' },
      { ...OLDER, error: 'Nothing was heard from this run for 2h.' },
    ]);
    expect(raise.ask).toBe(
      'A session on it stopped because "Main was red from another merge". Send #1801 Raise a stalled feature again as it stands?',
    );
    expect(raise.detail).toContain('- 2026-10-11: "Main was red from another merge."');
    expect(raise.detail).toContain(
      '- 2026-10-10: the session said nothing; the app noted "Nothing was heard from this run for 2h."',
    );
    expect(raise.consequence.name).toBe('send_step');
  });

  it('lists the pieces a too-big step would split into', () => {
    const raise = stallRaise(FEATURE, [
      {
        ...NEWER,
        stopReason: 'Too big for one sitting.',
        stopPieces: ['Read the runs', 'Write the raise', 'Hold on No'],
      },
      OLDER,
    ]);
    expect(raise.ask).toBe(
      'The sessions found #1801 Raise a stalled feature too big for one sitting and would split it into 3 steps. Send it again as it stands?',
    );
    expect(raise.detail).toContain('1. Read the runs\n2. Write the raise\n3. Hold on No');
  });

  it('keeps the ask inside the column with the longest reason and title', () => {
    const raise = stallRaise(
      { ...FEATURE, title: 'x'.repeat(200) },
      [{ ...NEWER, stopReason: 'y'.repeat(300) }, OLDER],
    );
    expect(raise.ask.length).toBeLessThanOrEqual(500);
    expect(raise.title.length).toBeLessThanOrEqual(200);
    expect(raise.source.length).toBeLessThanOrEqual(200);
  });
});
