/**
 * Does the chance number separate the applications that reached an interview
 * from the ones that did not? (plan #1204)
 *
 * scripts/chance-check.ts scores the closed applications once, as though each
 * were still waiting, and hands the numbers here. The measures are the ones the
 * comment on feature #1192 reports:
 *
 * - `auc`: the chance that an application which reached an interview scored
 *   higher than one which did not, ties counted as half. 0.5 is a coin toss.
 * - `meanPercentile`: where the interviewed ones sit on average in the ranking,
 *   from 0 (lowest chance) to 100 (highest), ties sharing their average place.
 *
 * Pure, so the arithmetic is tested apart from Jev.
 */

/** One closed application as the check reads it. */
export type ChanceOutcome = { id: string; chance: number; interviewed: boolean };

/** At or above this AUC the number is shown; below it, the band. */
export const CHANCE_AUC_FOR_NUMBER = 0.7;

/**
 * Each value's place in ascending order, 1-based, with tied values given the
 * average of the places they share.
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end += 1;
    const shared = (start + end) / 2 + 1;
    for (let i = start; i <= end; i += 1) ranks[order[i].index] = shared;
    start = end + 1;
  }
  return ranks;
}

/** The Mann-Whitney AUC. Null when either group is empty. */
export function chanceAuc(rows: readonly ChanceOutcome[]): number | null {
  const positives = rows.filter((row) => row.interviewed).length;
  const negatives = rows.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const ranks = averageRanks(rows.map((row) => row.chance));
  const rankSum = rows.reduce((sum, row, i) => (row.interviewed ? sum + ranks[i] : sum), 0);
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** A row's percentile in the ranking: 0 for the lowest chance, 100 for the highest. */
export function percentiles(rows: readonly ChanceOutcome[]): number[] {
  if (rows.length < 2) return rows.map(() => 50);
  const ranks = averageRanks(rows.map((row) => row.chance));
  return ranks.map((rank) => ((rank - 1) / (rows.length - 1)) * 100);
}

/** The value below which `share` of the values fall, by linear interpolation between neighbours. */
export function quantile(values: readonly number[], share: number): number {
  if (values.length === 0) throw new Error('quantile of nothing');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * share;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** Where the bands split: a value at or above `medium` is medium, at or above `high` is high. */
export type ChanceBandEdges = { medium: number; high: number };

/**
 * Edges that put about a third of the scored applications in each band,
 * rounded to whole numbers since the stored chance is one.
 */
export function tercileEdges(values: readonly number[]): ChanceBandEdges {
  return { medium: Math.round(quantile(values, 1 / 3)), high: Math.round(quantile(values, 2 / 3)) };
}

export type ChanceBand = 'low' | 'medium' | 'high';

export function chanceBand(value: number, edges: ChanceBandEdges): ChanceBand {
  if (value >= edges.high) return 'high';
  if (value >= edges.medium) return 'medium';
  return 'low';
}

export type ChanceCheck = {
  scored: number;
  interviewed: number;
  auc: number | null;
  /** Mean percentile of the interviewed ones; 50 is where chance alone puts them. */
  meanPercentile: number | null;
  /** The percentile of each interviewed one, highest first. */
  interviewedPercentiles: number[];
  meanChance: { interviewed: number | null; rest: number | null };
  edges: ChanceBandEdges | null;
  /** How many fell in each band, and how many of those reached an interview. */
  bands: Record<ChanceBand, { count: number; interviewed: number }>;
  display: 'number' | 'band';
};

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Everything the comment reports, and the display the criterion picks. */
export function checkChance(rows: readonly ChanceOutcome[]): ChanceCheck {
  const auc = chanceAuc(rows);
  const place = percentiles(rows);
  const interviewedPercentiles = rows
    .map((row, i) => (row.interviewed ? place[i] : null))
    .filter((p): p is number => p !== null)
    .sort((a, b) => b - a);
  const edges = rows.length > 0 ? tercileEdges(rows.map((row) => row.chance)) : null;
  const bands: ChanceCheck['bands'] = {
    low: { count: 0, interviewed: 0 },
    medium: { count: 0, interviewed: 0 },
    high: { count: 0, interviewed: 0 },
  };
  if (edges) {
    for (const row of rows) {
      const band = bands[chanceBand(row.chance, edges)];
      band.count += 1;
      if (row.interviewed) band.interviewed += 1;
    }
  }
  return {
    scored: rows.length,
    interviewed: interviewedPercentiles.length,
    auc,
    meanPercentile: mean(interviewedPercentiles),
    interviewedPercentiles,
    meanChance: {
      interviewed: mean(rows.filter((row) => row.interviewed).map((row) => row.chance)),
      rest: mean(rows.filter((row) => !row.interviewed).map((row) => row.chance)),
    },
    edges,
    bands,
    display: auc !== null && auc >= CHANCE_AUC_FOR_NUMBER ? 'number' : 'band',
  };
}

/** How chance shows on the page: the number itself, or the band it falls in. */
export type ChanceDisplay = { kind: 'number' } | { kind: 'band'; edges: ChanceBandEdges };

/**
 * What the run of 29 September 2026 chose, for #1205 and #1206 to read.
 *
 * 266 closed applications scored, 15 of which reached an interview: AUC 0.43,
 * mean percentile of the 15 was 43, mean chance 30 against 32 for the rest.
 * The number does not rank them higher, so chance shows as a band, with edges
 * at the terciles of that run. Re-run scripts/chance-check.ts and change this
 * when the questions or the history change enough to matter.
 */
export const CHANCE_DISPLAY: ChanceDisplay = { kind: 'band', edges: { medium: 27, high: 38 } };

export const CHANCE_BAND_LABELS: Record<ChanceBand, string> = { low: 'Low', medium: 'Medium', high: 'High' };
