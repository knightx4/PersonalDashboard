import { describe, expect, it } from 'vitest';
import {
  STOP_PIECES_MAX,
  STOP_REASON_MAX,
  runForStop,
  stopColumns,
  stopLine,
  stopRefusal,
  type StopRunCandidate,
} from './stop-reason';

const run = (over: Partial<StopRunCandidate> = {}): StopRunCandidate => ({
  id: 'run-1',
  planItemId: 'step',
  status: 'started',
  createdAt: '2026-10-11T02:00:00.000Z',
  ...over,
});

describe('stopLine', () => {
  it('folds a reason onto one line', () => {
    expect(stopLine('  Too big.\n\nSix  pieces. ')).toBe('Too big. Six pieces.');
  });

  it('reads a missing value as empty', () => {
    expect(stopLine(null)).toBe('');
  });
});

describe('stopRefusal', () => {
  it('takes a reason on its own', () => {
    expect(stopRefusal('Ran out of room before the tests passed.', [])).toBeNull();
  });

  it('takes a reason with a split', () => {
    expect(stopRefusal('Too big.', ['Add the column', 'Read it on the page'])).toBeNull();
  });

  it('refuses no reason', () => {
    expect(stopRefusal('', [])).toMatch(/--reason/);
  });

  it('refuses a reason over the limit', () => {
    expect(stopRefusal('x'.repeat(STOP_REASON_MAX + 1), [])).toMatch(/characters/);
  });

  it('refuses a split of one', () => {
    expect(stopRefusal('Too big.', ['Everything'])).toMatch(/not a split/);
  });

  it('refuses too many pieces', () => {
    const pieces = Array.from({ length: STOP_PIECES_MAX + 1 }, (_, i) => `Piece ${i}`);
    expect(stopRefusal('Too big.', pieces)).toMatch(/more than/);
  });

  it('refuses an empty piece, naming which', () => {
    expect(stopRefusal('Too big.', ['One', ''])).toBe('Piece 2 is empty.');
  });
});

describe('runForStop', () => {
  it('takes the newest run on the step or a row above it', () => {
    const runs = [
      run({ id: 'old-step', planItemId: 'step', createdAt: '2026-10-10T02:00:00.000Z' }),
      run({ id: 'feature', planItemId: 'feature', createdAt: '2026-10-11T03:00:00.000Z' }),
      run({ id: 'elsewhere', planItemId: 'other', createdAt: '2026-10-11T04:00:00.000Z' }),
    ];
    expect(runForStop(runs, ['step', 'feature'])?.id).toBe('feature');
  });

  it('finds nothing when no run was fired at the step or above it', () => {
    expect(runForStop([run({ planItemId: 'other' })], ['step'])).toBeNull();
  });
});

describe('stopColumns', () => {
  const at = '2026-10-11T03:00:00.000Z';

  it('ends a run still going, with the reason as its error', () => {
    expect(stopColumns({ status: 'started' }, 'Too big.', [], at)).toEqual({
      stop_reason: 'Too big.',
      stop_pieces: null,
      stopped_at: at,
      status: 'failed',
      error: 'Too big.',
    });
  });

  it("leaves the app's note on a run the cutoff ended", () => {
    expect(stopColumns({ status: 'failed' }, 'Too big.', ['A', 'B'], at)).toEqual({
      stop_reason: 'Too big.',
      stop_pieces: ['A', 'B'],
      stopped_at: at,
    });
  });
});
