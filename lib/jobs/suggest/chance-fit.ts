import { CHANCE_WEIGHTS, chanceFeatures, type ChanceWeights, type RubricBreakdown } from './rubric';
import { chanceAuc } from './chance-check';

/**
 * Fit the chance weights on closed applications (17 November 2026).
 *
 * scripts/chance-check.ts scores each closed application with the rubric as
 * though it were still waiting, against only the history sent before it, and
 * keeps every factor answer. This fits CHANCE_WEIGHTS to those answers and
 * whether each reached an interview: a logistic regression on the features
 * `chanceFeatures` builds, with a ridge pull toward the hand-set weights so
 * thirty or so interviews cannot swing a weight far on noise.
 *
 * Pure, so the arithmetic is tested apart from Jev.
 */

export type FitRow = { chance: RubricBreakdown['chance']; interviewed: boolean };

const KEYS = Object.keys(CHANCE_WEIGHTS) as (keyof ChanceWeights)[];

/**
 * The hand-set weights a fit starts from and is pulled toward: no intercept,
 * the base rate as it is, and a guess for each factor. Kept apart from the
 * fitted CHANCE_WEIGHTS so a refit does not lean on the last one.
 */
export const STARTING_WEIGHTS: ChanceWeights = {
  intercept: 0,
  base: 1,
  chance_requirements: 0.3,
  chance_level: 0.5,
  chance_background: 0.3,
  chance_blocker: -1,
  chance_competition: 0.2,
  referral: 0.9,
  cover_letter: 0.15,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function predict(weights: Readonly<ChanceWeights>, x: Record<keyof ChanceWeights, number>): number {
  let total = 0;
  for (const key of KEYS) total += weights[key] * x[key];
  return sigmoid(total);
}

/**
 * The weights that best predict the outcomes, by gradient descent on the
 * log loss plus `ridge` times the squared distance from `start`.
 */
export function fitChanceWeights(
  rows: readonly FitRow[],
  options: { start?: ChanceWeights; ridge?: number; steps?: number; rate?: number } = {},
): ChanceWeights {
  const start = options.start ?? STARTING_WEIGHTS;
  const ridge = options.ridge ?? 0.01;
  const steps = options.steps ?? 4000;
  const rate = options.rate ?? 0.1;
  const xs = rows.map((row) => chanceFeatures(row.chance));
  const weights = { ...start } as ChanceWeights;
  if (rows.length === 0) return weights;
  for (let step = 0; step < steps; step += 1) {
    const grad = Object.fromEntries(KEYS.map((key) => [key, 0])) as ChanceWeights;
    rows.forEach((row, i) => {
      const error = predict(weights, xs[i]) - (row.interviewed ? 1 : 0);
      for (const key of KEYS) grad[key] += error * xs[i][key];
    });
    for (const key of KEYS) {
      weights[key] -= rate * (grad[key] / rows.length + ridge * (weights[key] - start[key]));
    }
  }
  for (const key of KEYS) weights[key] = Math.round(weights[key] * 100) / 100;
  return weights;
}

/** The predicted chance of each row under the weights, 0 to 1. */
export function predictAll(rows: readonly FitRow[], weights: Readonly<ChanceWeights>): number[] {
  return rows.map((row) => predict(weights, chanceFeatures(row.chance)));
}

/** AUC of the rows under the weights. */
export function aucUnder(rows: readonly FitRow[], weights: Readonly<ChanceWeights>): number | null {
  const p = predictAll(rows, weights);
  return chanceAuc(rows.map((row, i) => ({ id: String(i), chance: p[i], interviewed: row.interviewed })));
}

/**
 * The AUC of weights fitted without each fold, scored on that fold: what a
 * fit does on applications it has not seen. Rows are split by position, so
 * pass them in the order they were sent.
 */
export function crossValidatedAuc(rows: readonly FitRow[], folds = 5, options: { ridge?: number } = {}): number | null {
  const scored: { id: string; chance: number; interviewed: boolean }[] = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const train = rows.filter((_, i) => i % folds !== fold);
    const test = rows.filter((_, i) => i % folds === fold);
    const weights = fitChanceWeights(train, options);
    predictAll(test, weights).forEach((chance, i) => scored.push({ id: `${fold}-${i}`, chance, interviewed: test[i].interviewed }));
  }
  return chanceAuc(scored);
}

/** Mean predicted chance against the share that reached an interview, for calibration. */
export function calibration(rows: readonly FitRow[], weights: Readonly<ChanceWeights>): { predicted: number; actual: number } {
  const p = predictAll(rows, weights);
  const predicted = p.reduce((a, b) => a + b, 0) / Math.max(1, p.length);
  const actual = rows.filter((row) => row.interviewed).length / Math.max(1, rows.length);
  return { predicted, actual };
}
