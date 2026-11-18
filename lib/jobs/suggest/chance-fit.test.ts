import { describe, expect, it } from 'vitest';
import { STARTING_WEIGHTS, aucUnder, fitChanceWeights, type FitRow } from './chance-fit';
import { CHANCE_WEIGHTS } from './rubric';

/** Requirements decide the outcome; competition is noise. */
function rows(): FitRow[] {
  const out: FitRow[] = [];
  for (let i = 0; i < 200; i += 1) {
    const req = i % 5;
    out.push({
      chance: { base: 0.1, chance_requirements: { score: req, sd: 0 }, chance_competition: { score: (i * 7) % 5, sd: 0 } },
      interviewed: req === 4 && i % 3 !== 0,
    });
  }
  return out;
}

describe('fitChanceWeights', () => {
  it('raises the weight of the factor that predicts the outcome', () => {
    const fitted = fitChanceWeights(rows());
    expect(fitted.chance_requirements).toBeGreaterThan(STARTING_WEIGHTS.chance_requirements);
    expect(aucUnder(rows(), fitted)!).toBeGreaterThanOrEqual(aucUnder(rows(), CHANCE_WEIGHTS)!);
  });

  it('returns the starting weights with no rows', () => {
    expect(fitChanceWeights([])).toEqual(STARTING_WEIGHTS);
  });
});
