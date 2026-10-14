import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';

/**
 * How well you know an idea on a given day, from 0 to 1 (plan #1997.1).
 *
 * Pure, and it takes the date, so the map can ask for today and the timeline
 * for any other day. The score is level times evidence times memory:
 *
 * - level: what the state says you can do (shaky 0.35 up to sharp 1).
 * - evidence: how the state came to be believed (tested 1, declared 0.75,
 *   inferred 0.5).
 * - memory: 2 to the power of minus the days since the state was set over a
 *   half-life. The state is set at `tested_at`, or at `declared_at` when the
 *   idea was never tested. A reviewed idea (`review_interval_days` set) has a
 *   half-life of 1.5 times that interval; an unreviewed one halves every 30
 *   days when tested and every 45 when declared.
 *
 * An idea with no date to measure from (inferred from something above it)
 * does not fade: its memory is 1 and the 0.5 evidence is the whole discount.
 * A misconception scores 0 and is reported by `isMisconception`, because it
 * is a different problem from a low score. `unknown` scores 0 too.
 */

export const LEVEL_WEIGHT: Record<KnowledgeState, number> = {
  unknown: 0,
  shaky: 0.35,
  recognised: 0.55,
  known: 0.8,
  sharp: 1,
  misconception: 0,
};

export const EVIDENCE_WEIGHT: Record<StateBasis, number> = {
  tested: 1,
  declared: 0.75,
  inferred: 0.5,
};

/** Half-life in days of an idea that has never been reviewed. */
export const HALF_LIFE_TESTED_DAYS = 30;
export const HALF_LIFE_DECLARED_DAYS = 45;
/** A review interval is stretched by this much to give the half-life. */
export const REVIEW_HALF_LIFE_FACTOR = 1.5;

/** The nearest known ideas an unknown idea draws haze from. */
export const SPILL_NEIGHBOURS = 6;

/** The columns of `learn.concept_state` the score reads. */
export type StrengthInput = {
  state: KnowledgeState;
  established: StateBasis;
  tested_at: string | Date | null;
  declared_at: string | Date | null;
  review_interval_days: number | null;
};

const DAY_MS = 86_400_000;

function time(value: string | Date | null): number | null {
  if (value === null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** The day the state was set: tested_at, else declared_at, else none. */
export function stateSetAt(row: Pick<StrengthInput, 'tested_at' | 'declared_at'>): Date | null {
  const t = time(row.tested_at) ?? time(row.declared_at);
  return t === null ? null : new Date(t);
}

/** Days for the memory of this idea to halve. */
export function halfLifeDays(
  row: Pick<StrengthInput, 'established' | 'tested_at' | 'review_interval_days'>,
): number {
  if (row.review_interval_days !== null && row.review_interval_days > 0) {
    return row.review_interval_days * REVIEW_HALF_LIFE_FACTOR;
  }
  return row.established === 'declared' || row.tested_at === null
    ? HALF_LIFE_DECLARED_DAYS
    : HALF_LIFE_TESTED_DAYS;
}

/** 1 on the day the state was set, halving every half-life after. */
export function memory(row: StrengthInput, on: Date): number {
  const set = stateSetAt(row);
  if (set === null) return 1;
  const days = Math.max(0, (on.getTime() - set.getTime()) / DAY_MS);
  return Math.pow(2, -days / halfLifeDays(row));
}

/** How well the idea is known on `on`, from 0 to 1. */
export function strength(row: StrengthInput, on: Date): number {
  const level = LEVEL_WEIGHT[row.state];
  if (level === 0) return 0;
  return level * EVIDENCE_WEIGHT[row.established] * memory(row, on);
}

/** A misconception is flagged on its own, never as a low score. */
export function isMisconception(row: Pick<StrengthInput, 'state'>): boolean {
  return row.state === 'misconception';
}

/** The next day after `from` on which the strength has halved again, or null when it does not fade. */
export function halvesOn(row: StrengthInput, from: Date): Date | null {
  const set = stateSetAt(row);
  if (set === null || LEVEL_WEIGHT[row.state] === 0) return null;
  const half = halfLifeDays(row) * DAY_MS;
  const elapsed = Math.max(0, from.getTime() - set.getTime());
  const next = Math.floor(elapsed / half) + 1;
  return new Date(set.getTime() + next * half);
}

/** A known idea near an unknown one: its strength on the day and how alike they are (cosine, 0 to 1). */
export type SpillNeighbour = { strength: number; similarity: number };

/**
 * The haze an unknown idea carries from the known ideas beside it: the sum of
 * strength times similarity squared over its six nearest, capped at 1.
 * Pass any number of neighbours; the six most similar count.
 */
export function spillOver(neighbours: readonly SpillNeighbour[]): number {
  const nearest = [...neighbours]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SPILL_NEIGHBOURS);
  let sum = 0;
  for (const n of nearest) {
    const s = Math.max(0, n.similarity);
    sum += Math.max(0, n.strength) * s * s;
  }
  return Math.min(1, sum);
}
