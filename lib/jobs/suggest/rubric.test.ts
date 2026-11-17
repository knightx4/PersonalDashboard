import { describe, expect, it } from 'vitest';
import type { PastApplication } from './history';
import { STARTING_WEIGHTS } from './chance-fit';
import {
  CHANCE_CEILING,
  CHANCE_FLOOR,
  DEALBREAKER_CAP,
  PRIOR_RATE,
  baseRate,
  combineChance,
  combineFit,
  fitDrivers,
  interviewLevels,
  payFactor,
  requirementCoverage,
  scoreFactor,
} from './rubric';
import { rubricFitReason } from './reasons';

const NOW = new Date('2026-11-17T00:00:00Z');

function app(id: string, title: string, over: Partial<PastApplication> = {}): PastApplication {
  return { id, title, company: 'Acme', status: 'rejected', rejectionStage: 'resume_review', hasInterview: false, sentAt: '2026-10-01', ...over };
}

describe('baseRate', () => {
  it('starts at the prior with no history', () => {
    expect(baseRate('FP&A Analyst', [], { now: NOW }).rate).toBeCloseTo(PRIOR_RATE, 5);
  });

  it('rises with interviews on similar roles and is pulled toward the overall rate when they are few', () => {
    const history = [app('1', 'FP&A Analyst', { hasInterview: true }), app('2', 'FP&A Analyst')];
    const rate = baseRate('Senior FP&A Analyst', history, { now: NOW }).rate;
    expect(rate).toBeGreaterThan(PRIOR_RATE);
    expect(rate).toBeLessThan(0.5);
  });

  it('leaves out a recent application still waiting, and counts an old one as a no', () => {
    const recent = [app('1', 'FP&A Analyst', { status: 'submitted', rejectionStage: null, sentAt: '2026-11-10' })];
    expect(baseRate('FP&A Analyst', recent, { now: NOW }).overall).toBe(0);
    const old = [app('1', 'FP&A Analyst', { status: 'submitted', rejectionStage: null, sentAt: '2026-08-01' })];
    expect(baseRate('FP&A Analyst', old, { now: NOW }).overall).toBeGreaterThan(0);
  });

  it('counts only applications sent the same way', () => {
    const easy = [app('1', 'FP&A Analyst', { source: 'linkedin', hasInterview: true })];
    expect(baseRate('FP&A Analyst', easy, { now: NOW }).overall).toBe(0);
    expect(baseRate('FP&A Analyst', easy, { now: NOW, channel: 'easy_apply' }).overall).toBeGreaterThan(0);
  });

  it('sees nothing sent on or after asOf, for the back-test', () => {
    const history = [app('1', 'FP&A Analyst', { hasInterview: true, sentAt: '2026-10-01' })];
    expect(baseRate('FP&A Analyst', history, { asOf: '2026-09-01' }).overall).toBe(0);
    expect(baseRate('FP&A Analyst', history, { asOf: '2026-10-15' }).overall).toBeGreaterThan(0);
  });

  it('leaves out the application itself', () => {
    const history = [app('1', 'FP&A Analyst', { hasInterview: true })];
    expect(baseRate('FP&A Analyst', history, { now: NOW, excludeId: '1' }).overall).toBe(0);
  });
});

describe('interviewLevels', () => {
  it('counts the levels of the applications that reached an interview', () => {
    const history = [
      app('1', 'FP&A Analyst', { hasInterview: true }),
      app('2', 'Finance Manager', { status: 'in_process' }),
      app('3', 'Director of Finance'),
    ];
    expect(interviewLevels(history)).toEqual({ entry: 1, mid: 1 });
  });
});

describe('requirementCoverage', () => {
  it('weighs must-haves twice and partial half', () => {
    expect(
      requirementCoverage([
        { requirement: 'a', kind: 'must_have', verdict: 'strong', evidenceItemId: null, why: '' },
        { requirement: 'b', kind: 'nice_to_have', verdict: 'partial', evidenceItemId: null, why: '' },
        { requirement: 'c', kind: 'must_have', verdict: 'gap', evidenceItemId: null, why: '' },
      ]),
    ).toBeCloseTo(2.5 / 5, 5);
    expect(requirementCoverage([])).toBeNull();
    expect(requirementCoverage(null)).toBeNull();
  });
});

describe('scoreFactor and payFactor', () => {
  it('reads the spread of the level probabilities', () => {
    const sure = scoreFactor({ ok: true, model: 'm', answer: { type: 'score', score: 3, level: 3, confidence: 0.9, probabilities: [0, 0, 0, 1, 0] } });
    expect(sure).toEqual({ score: 3, sd: 0 });
    const split = scoreFactor({ ok: true, model: 'm', answer: { type: 'score', score: 2, level: 2, confidence: 0.3, probabilities: [0, 0.5, 0, 0.5, 0] } });
    expect(split?.sd).toBe(1);
  });

  it('drops pay when none is given, and averages the given choices otherwise', () => {
    expect(payFactor({ ok: true, model: 'm', answer: { type: 'choice', choice: 'not_given', confidence: 0.9, probabilities: { not_given: 0.9 } } })).toBeUndefined();
    const pay = payFactor({
      ok: true,
      model: 'm',
      answer: { type: 'choice', choice: 'strong', confidence: 0.5, probabilities: { strong: 0.5, fair: 0.5, low: 0, not_given: 0 } },
    });
    expect(pay?.score).toBe(3);
  });
});

describe('combineFit', () => {
  it('weighs the kind of work above the rest', () => {
    const goodWork = combineFit({ fit_work: { score: 4, sd: 0 }, fit_pay: { score: 0, sd: 0 } });
    const goodPay = combineFit({ fit_work: { score: 0, sd: 0 }, fit_pay: { score: 4, sd: 0 } });
    expect(goodWork!.value).toBe(75);
    expect(goodPay!.value).toBe(25);
  });

  it('caps the figure when a dealbreaker is likely', () => {
    const fit = combineFit({ fit_work: { score: 4, sd: 0 }, fit_ruled_out: { score: 0.7, sd: 0.46 } });
    expect(fit!.value).toBe(DEALBREAKER_CAP);
  });

  it('is less sure the wider the answers spread, and undefined with no factor', () => {
    expect(combineFit({ fit_work: { score: 2, sd: 0 } })!.confidence).toBe(1);
    expect(combineFit({ fit_work: { score: 2, sd: 1 } })!.confidence).toBeLessThan(0.5);
    expect(combineFit({})).toBeUndefined();
  });
});

describe('combineChance', () => {
  it('is the base rate when every factor sits at its middle', () => {
    const chance = combineChance({
      base: 0.1,
      chance_requirements: { score: 2, sd: 0 },
      chance_level: { score: 2, sd: 0 },
      chance_background: { score: 2, sd: 0 },
      chance_competition: { score: 2, sd: 0 },
      chance_blocker: { score: 0, sd: 0 },
    }, STARTING_WEIGHTS);
    expect(chance.value).toBe(10);
  });

  it('moves with each factor in the right direction', () => {
    const base = combineChance({ base: 0.1 }).value;
    expect(combineChance({ base: 0.1, chance_requirements: { score: 4, sd: 0 } }).value).toBeGreaterThan(base);
    expect(combineChance({ base: 0.1, chance_level: { score: 0, sd: 0 } }).value).toBeLessThan(base);
    expect(combineChance({ base: 0.1, chance_blocker: { score: 1, sd: 0 } }).value).toBeLessThan(base);
    expect(combineChance({ base: 0.1, referral: true }).value).toBeGreaterThan(base);
  });

  it('stays between the floor and the ceiling', () => {
    expect(combineChance({ base: 0.0001, chance_blocker: { score: 1, sd: 0 } }).value).toBe(CHANCE_FLOOR);
    expect(combineChance({ base: 0.99, referral: true }).value).toBe(CHANCE_CEILING);
  });
});

describe('fitDrivers and the reason line', () => {
  it('names the factor that pulled most each way', () => {
    const fit = { fit_work: { score: 4, sd: 0 }, fit_pay: { score: 0, sd: 0 }, fit_level: { score: 2, sd: 0 } };
    expect(fitDrivers(fit)).toEqual({ dealbreaker: null, best: 'fit_work', worst: 'fit_pay' });
    expect(rubricFitReason(fit)).toBe('The work you want, but low pay');
  });

  it('puts a dealbreaker first', () => {
    expect(rubricFitReason({ fit_work: { score: 4, sd: 0 }, fit_excluded_industry: { score: 0.9, sd: 0.3 } })).toBe(
      'In an industry you excluded',
    );
  });
});
