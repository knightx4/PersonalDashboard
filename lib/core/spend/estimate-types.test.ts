import { describe, expect, it } from 'vitest';
import {
  approxDollars,
  costHintText,
  scaleEstimate,
  sumEstimates,
  type CostEstimate,
} from './estimate-types';

const measured: CostEstimate = {
  lowMicros: 300_000,
  medianMicros: 400_000,
  highMicros: 760_000,
  runs: 12,
  basis: 'measured',
  per: 'run',
};

const guess: CostEstimate = {
  lowMicros: 30_000,
  medianMicros: 50_000,
  highMicros: 90_000,
  runs: 1,
  basis: 'guess',
  per: 'run',
};

describe('costHintText', () => {
  it('gives a measured estimate its range and run count', () => {
    expect(costHintText(measured)).toBe('About $0.40, usually $0.30 to $0.76, from 12 runs');
  });

  it('labels a guess uncertain and gives no range', () => {
    expect(costHintText(guess)).toBe('About $0.05, uncertain');
  });

  it('says under a cent rather than $0.00', () => {
    expect(costHintText({ ...guess, medianMicros: 400 })).toBe('Under a cent, uncertain');
  });

  it('drops a range whose ends round to the same cent', () => {
    expect(
      costHintText({ ...measured, lowMicros: 20_000, medianMicros: 21_000, highMicros: 24_000 }),
    ).toBe('About $0.02, from 12 runs');
  });

  it('multiplies a per-unit estimate by the count', () => {
    const perReading: CostEstimate = { ...guess, per: 'unit', medianMicros: 20_000 };
    expect(costHintText(perReading, 12)).toBe('About $0.24, uncertain');
  });
});

describe('scaleEstimate', () => {
  it('leaves a per-run estimate alone whatever the count', () => {
    expect(scaleEstimate(measured, 5)).toBe(measured);
  });

  it('leaves a per-unit estimate alone when no count is given', () => {
    const perUnit: CostEstimate = { ...measured, per: 'unit' };
    expect(scaleEstimate(perUnit, undefined)).toBe(perUnit);
  });
});

describe('sumEstimates', () => {
  it('adds the figures and is a guess when any part is', () => {
    expect(sumEstimates([measured, guess])).toEqual({
      lowMicros: 330_000,
      medianMicros: 450_000,
      highMicros: 850_000,
      runs: 1,
      basis: 'guess',
      per: 'run',
    });
  });

  it('is measured when every part is', () => {
    expect(sumEstimates([measured, measured])?.basis).toBe('measured');
  });

  it('is nothing for no parts', () => {
    expect(sumEstimates([])).toBeNull();
  });
});

describe('approxDollars', () => {
  it('rounds to the cent', () => {
    expect(approxDollars(1_234_567)).toBe('$1.23');
  });
});
