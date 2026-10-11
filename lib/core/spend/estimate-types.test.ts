import { describe, expect, it } from 'vitest';
import {
  approxDollars,
  costHintModels,
  costHintText,
  modelLabel,
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
  models: ['claude-sonnet-5-5'],
};

const guess: CostEstimate = {
  lowMicros: 30_000,
  medianMicros: 50_000,
  highMicros: 90_000,
  runs: 1,
  basis: 'guess',
  per: 'run',
  models: ['jev-1.13.0', 'claude-sonnet-5-5'],
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
      models: ['claude-sonnet-5-5', 'jev-1.13.0'],
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

describe('modelLabel', () => {
  it('names a model the way the hint says it', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('jev-1.13.0')).toBe('Jev');
    expect(modelLabel('voyage-4-lite')).toBe('Voyage 4 Lite');
  });
});

describe('costHintModels', () => {
  it('names the one model a press calls', () => {
    expect(costHintModels(measured)).toBe('Uses Sonnet 5.5');
  });

  it('names every model when a press runs several', () => {
    expect(costHintModels(guess)).toBe('Uses Jev and Sonnet 5.5');
    expect(
      costHintModels({ ...guess, models: ['claude-haiku-5-5', 'claude-opus-5-5', 'jev-1.13.0'] }),
    ).toBe('Uses Haiku 5.5, Opus 5.5 and Jev');
  });

  it('says nothing when the estimate names no model', () => {
    expect(costHintModels({ ...guess, models: [] })).toBe('');
  });
});
