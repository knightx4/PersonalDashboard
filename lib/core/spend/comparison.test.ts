import { describe, expect, it } from 'vitest';
import { compareEstimate, compareEstimates, EVERY_OPERATION, moduleOf } from './comparison';
import {
  guessEstimate,
  isBackgroundOperation,
  MEASURED_MIN_RUNS,
  type MeasuredRange,
} from './estimate';
import type { OperationName } from './guesses';

function range(runs: number, median: number): MeasuredRange {
  return { runs, lowMicros: median / 2, medianMicros: median, highMicros: median * 2 };
}

describe('compareEstimates', () => {
  it('lists every operation once, background ones apart', () => {
    const { foreground, background } = compareEstimates(new Map());
    const names = [...foreground, ...background].map((row) => row.operation);
    expect(names.sort()).toEqual([...EVERY_OPERATION].sort());
    expect(background.every((row) => isBackgroundOperation(row.operation))).toBe(true);
    expect(foreground.some((row) => isBackgroundOperation(row.operation))).toBe(false);
    expect(background.map((row) => row.operation)).toContain('map-sweep');
    expect(background.map((row) => row.operation)).toContain('digest-issue');
  });

  it('shows the guess, no actual and no runs for an operation the ledger has not seen', () => {
    const row = compareEstimate('draft-answer', undefined);
    expect(row.estimate).toEqual(guessEstimate('draft-answer'));
    expect(row.actualMicros).toBeNull();
    expect(row.runs).toBe(0);
    expect(row.guessVerdict).toBeNull();
  });

  it('keeps the guess as the estimate below the measured threshold, and says where the runs fell', () => {
    const guess = guessEstimate('write-opening-question').medianMicros;
    const row = compareEstimate('write-opening-question', range(1, guess * 10));
    expect(row.estimate.basis).toBe('guess');
    expect(row.actualMicros).toBe(guess * 10);
    expect(row.runs).toBe(1);
    expect(row.guessVerdict).toBe('above');
    expect(compareEstimate('write-opening-question', range(1, guess / 10)).guessVerdict).toBe(
      'below',
    );
    expect(compareEstimate('write-opening-question', range(1, guess)).guessVerdict).toBe('within');
  });

  it('makes a measured estimate the actual median, and keeps the guess to compare with', () => {
    const measured = range(MEASURED_MIN_RUNS, 7_000);
    const row = compareEstimate('classify-note', measured);
    expect(row.estimate.basis).toBe('measured');
    expect(row.estimate.medianMicros).toBe(row.actualMicros);
    expect(row.guess).toEqual(guessEstimate('classify-note'));
  });
});

describe('moduleOf', () => {
  it('names the module each operation is recorded under', () => {
    const cases: [OperationName, string][] = [
      ['enrich-company', 'jobs'],
      ['read-shelf-photo', 'shopping'],
      ['reply-to-comment', 'core'],
      ['digest-issue', 'news'],
      ['plan-topic', 'learn'],
    ];
    for (const [operation, module] of cases) expect(moduleOf(operation)).toBe(module);
  });
});
