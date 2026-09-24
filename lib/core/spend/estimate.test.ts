import { describe, expect, it, vi } from 'vitest';
import { LEARN_OPERATIONS } from '@/lib/learn/spend';
import {
  combineEstimates,
  estimateCost,
  estimateFor,
  guessEstimate,
  isBackgroundOperation,
  loadCostRanges,
  MEASURED_MIN_RUNS,
  UNIT_OPERATIONS,
  type MeasuredRange,
} from './estimate';
import { OPERATION_GUESSES, type OperationName } from './guesses';
import { SPEND_OPERATIONS } from './operations';
import { MODEL_PRICES } from './pricing';

const EVERY_OPERATION: string[] = [...LEARN_OPERATIONS, ...Object.values(SPEND_OPERATIONS).flat()];

function range(runs: number, low: number, median: number, high: number): MeasuredRange {
  return { runs, lowMicros: low, medianMicros: median, highMicros: high };
}

function clientReturning(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as never, rpc };
}

describe('the guess table', () => {
  it('has a guess for every operation name the ledger is written under, and no others', () => {
    expect(Object.keys(OPERATION_GUESSES).sort()).toEqual([...EVERY_OPERATION].sort());
  });

  it('prices every guess with a model the price table knows, at more than nothing', () => {
    for (const name of EVERY_OPERATION as OperationName[]) {
      expect(MODEL_PRICES[OPERATION_GUESSES[name].model], name).toBeDefined();
      expect(guessEstimate(name).medianMicros, name).toBeGreaterThan(0);
    }
  });

  it('marks the operations no button starts', () => {
    expect(isBackgroundOperation('classify-job-email')).toBe(true);
    expect(isBackgroundOperation('suggest-from-digest')).toBe(true);
    expect(isBackgroundOperation('map-sweep')).toBe(true);
    expect(isBackgroundOperation('plan-topic')).toBe(false);
    expect(isBackgroundOperation('estimate-resale-price')).toBe(false);
  });
});

describe('one operation', () => {
  it('is measured from five runs or more', () => {
    const estimate = estimateFor('plan-topic', range(MEASURED_MIN_RUNS, 100_000, 400_000, 700_000));
    expect(estimate).toEqual({
      lowMicros: 100_000,
      medianMicros: 400_000,
      highMicros: 700_000,
      runs: 5,
      basis: 'measured',
      per: 'run',
    });
  });

  it('falls back to the flagged guess with fewer runs, or none', () => {
    const guess = guessEstimate('plan-topic');
    expect(estimateFor('plan-topic', range(4, 1, 2, 3))).toEqual(guess);
    expect(estimateFor('plan-topic', undefined)).toEqual(guess);
    expect(guess.basis).toBe('guess');
    expect(guess.runs).toBe(0);
    // Opus at 40k in and 8k out: 40,000×$5 + 8,000×$25 per million.
    expect(guess.medianMicros).toBe(400_000);
    expect(guess.lowMicros).toBe(200_000);
    expect(guess.highMicros).toBe(800_000);
  });

  it('is per unit where the cost grows with a count, measured or guessed', () => {
    expect(UNIT_OPERATIONS).toContain('estimate-resale-price');
    expect(UNIT_OPERATIONS).toContain('resolve-reference');
    expect(UNIT_OPERATIONS).not.toContain('plan-topic');
    expect(guessEstimate('estimate-resale-price').per).toBe('unit');
    expect(estimateFor('extract-email-order', range(20, 4_000, 5_000, 9_000)).per).toBe('unit');
  });
});

describe('a press that runs several operations', () => {
  it('adds them up, scaling a per-unit part by its count', () => {
    const ranges = new Map<OperationName, MeasuredRange>([
      ['parse-references', range(6, 8_000, 10_000, 14_000)],
      ['resolve-reference', range(30, 40_000, 60_000, 90_000)],
      ['plan-topic', range(5, 100_000, 400_000, 700_000)],
    ]);
    const total = combineEstimates(
      ['parse-references', { operation: 'resolve-reference', count: 3 }, 'plan-topic'],
      ranges,
    );
    expect(total).toEqual({
      lowMicros: 8_000 + 120_000 + 100_000,
      medianMicros: 10_000 + 180_000 + 400_000,
      highMicros: 14_000 + 270_000 + 700_000,
      runs: 5,
      basis: 'measured',
      per: 'run',
    });
  });

  it('is a guess when any part is', () => {
    const ranges = new Map<OperationName, MeasuredRange>([
      ['parse-references', range(6, 8_000, 10_000, 14_000)],
    ]);
    const total = combineEstimates(['parse-references', 'plan-topic'], ranges);
    expect(total?.basis).toBe('guess');
    expect(total?.runs).toBe(0);
    expect(total?.medianMicros).toBe(10_000 + guessEstimate('plan-topic').medianMicros);
  });

  it('is nothing when given nothing', () => {
    expect(combineEstimates([], new Map())).toBeNull();
  });
});

describe('reading the ledger', () => {
  it('asks once, naming the per-unit operations, and reads the ranges back', async () => {
    const { client, rpc } = clientReturning({
      data: [
        { operation: 'estimate-resale-price', runs: 12, low_micros: '5000', median_micros: 7000, high_micros: 11000 },
      ],
      error: null,
    });

    const ranges = await loadCostRanges(client, 'user-1', ['estimate-resale-price', 'plan-topic']);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('spend_cost_ranges', {
      p_user_id: 'user-1',
      p_operations: ['estimate-resale-price', 'plan-topic'],
      p_unit_operations: ['estimate-resale-price'],
      p_days: 30,
    });
    expect(ranges.get('estimate-resale-price')).toEqual(range(12, 5_000, 7_000, 11_000));
    expect(ranges.has('plan-topic')).toBe(false);
  });

  it('falls back to guesses when the read fails, rather than failing the page', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'permission denied' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const estimate = await estimateCost(client, 'user-1', ['plan-topic']);

    expect(estimate).toEqual(guessEstimate('plan-topic'));
    spy.mockRestore();
  });

  it('does not call the database for an empty list', async () => {
    const { client, rpc } = clientReturning({ data: [], error: null });
    expect(await estimateCost(client, 'user-1', [])).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
