/**
 * The one way a found role is let onto the recommended list: Jev scores it
 * first, and one below the person's lowest fit score is kept as an expired
 * suggestion instead of shown (fit-gate.ts). Every source goes through here
 * when the person has Jev on: the web search and the followed boards
 * (store.ts) and the discovered startups (discover/roles-run.ts). A role that
 * could not be scored in time is let on unscored, and the daily scoring run
 * applies the same gate to it later (score-run.ts).
 */
import { belowFitGate } from './fit-gate';
import type { OpeningScores, OpeningText } from './scores';

/** Scores one role, or null when Jev could not. */
export type Scorer = (opening: OpeningText) => Promise<OpeningScores | null>;

export type Admitter = { score: Scorer; minFitScore: number };

export type Admission<T> = {
  item: T;
  scores: OpeningScores | null;
  /** Scored, and under the minimum: kept off the list. */
  belowGate: boolean;
};

/** Roles scored at once, and how long scoring may take in all. */
const PARALLEL = 6;
const BUDGET_MS = 25_000;

export async function admitOpenings<T>(
  items: readonly T[],
  toOpening: (item: T) => OpeningText,
  admitter: Admitter,
  budgetMs: number = BUDGET_MS,
): Promise<Admission<T>[]> {
  const out: Admission<T>[] = [];
  const began = Date.now();
  for (let i = 0; i < items.length; i += PARALLEL) {
    const batch = items.slice(i, i + PARALLEL);
    if (Date.now() - began >= budgetMs) {
      for (const item of batch) out.push({ item, scores: null, belowGate: false });
      continue;
    }
    const scores = await Promise.all(batch.map((item) => admitter.score(toOpening(item)).catch(() => null)));
    batch.forEach((item, index) => {
      out.push({ item, scores: scores[index], belowGate: belowFitGate(scores[index], admitter.minFitScore) });
    });
  }
  return out;
}

/** The columns a scored role is written with, so the daily scoring run leaves it alone. */
export function scoredColumns(admission: Admission<unknown>, model: string, now: Date = new Date()) {
  if (!admission.scores) return {};
  return {
    scores: admission.scores,
    scored_at: now.toISOString(),
    score_model: model,
    ...(admission.belowGate ? { status: 'expired', expired_reason: 'low_fit', acted_at: now.toISOString() } : {}),
  };
}
