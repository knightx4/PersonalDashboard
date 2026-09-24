import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { costMicrosFor, EMPTY_USAGE } from '@/lib/core/spend/pricing';
import {
  scaleEstimate,
  sumEstimates,
  type CostEstimate,
} from '@/lib/core/spend/estimate-types';
import { OPERATION_GUESSES, type OperationName } from '@/lib/core/spend/guesses';

/**
 * About how much an operation will cost before it runs.
 *
 * Measured from the ledger where there is enough history: the last thirty
 * days of `core.model_spend`, summarised per operation by the SQL function
 * `core.spend_cost_ranges` (migration 0102), which adds a press's several
 * calls together into one run. Five runs or more make the figure measured.
 * Fewer fall back to the written guess in guesses.ts, which the $ hint labels
 * uncertain.
 *
 * Pages compute these on the server and hand them to `CostHint`, which never
 * fetches. `estimateCost` is the one a button wants: every operation the press
 * runs, added up, from a single database call.
 */

/** Runs in the window it takes for a measured figure. Fewer is a guess. */
export const MEASURED_MIN_RUNS = 5;

/** How far back the ledger is read. */
export const ESTIMATE_WINDOW_DAYS = 30;

/** One operation's recent runs as the ledger summarises them. */
export type MeasuredRange = {
  runs: number;
  lowMicros: number;
  medianMicros: number;
  highMicros: number;
};

/** An operation, or an operation run a known number of times in one press. */
export type OperationCount = OperationName | { operation: OperationName; count: number };

/** Every operation whose figure is for one unit rather than one press. */
export const UNIT_OPERATIONS: readonly OperationName[] = (
  Object.keys(OPERATION_GUESSES) as OperationName[]
).filter((name) => OPERATION_GUESSES[name].per === 'unit');

/** Operations no button starts: they get no hint and are listed apart. */
export function isBackgroundOperation(operation: OperationName): boolean {
  return OPERATION_GUESSES[operation].background;
}

/**
 * The written guess, priced. The range is half to twice the typical figure:
 * wide, because a guess that looked precise would be read as a measurement.
 */
export function guessEstimate(operation: OperationName): CostEstimate {
  const guess = OPERATION_GUESSES[operation];
  const median =
    costMicrosFor(guess.model, {
      ...EMPTY_USAGE,
      inputTokens: guess.inputTokens,
      outputTokens: guess.outputTokens,
    }) ?? 0;
  return {
    lowMicros: Math.round(median / 2),
    medianMicros: median,
    highMicros: median * 2,
    runs: 0,
    basis: 'guess',
    per: guess.per,
  };
}

/** The measured range when there are enough runs, otherwise the guess. */
export function estimateFor(
  operation: OperationName,
  measured: MeasuredRange | null | undefined,
): CostEstimate {
  if (!measured || measured.runs < MEASURED_MIN_RUNS) return guessEstimate(operation);
  return {
    lowMicros: measured.lowMicros,
    medianMicros: measured.medianMicros,
    highMicros: measured.highMicros,
    runs: measured.runs,
    basis: 'measured',
    per: OPERATION_GUESSES[operation].per,
  };
}

type RangeRow = {
  operation: string;
  runs: number;
  low_micros: number | string;
  median_micros: number | string;
  high_micros: number | string;
};

/**
 * The ledger's recent range for each named operation, one call.
 *
 * An operation with no runs in the window is missing from the map. A failed
 * read is logged and returns an empty map, so the page falls back to guesses
 * rather than failing over a hint.
 */
export async function loadCostRanges(
  supabase: CoreSupabaseClient,
  userId: string,
  operations: readonly OperationName[],
): Promise<Map<OperationName, MeasuredRange>> {
  const ranges = new Map<OperationName, MeasuredRange>();
  const names = [...new Set(operations)];
  if (names.length === 0) return ranges;

  const { data, error } = await supabase.rpc('spend_cost_ranges', {
    p_user_id: userId,
    p_operations: names,
    p_unit_operations: names.filter((name) => OPERATION_GUESSES[name].per === 'unit'),
    p_days: ESTIMATE_WINDOW_DAYS,
  });
  if (error) {
    console.error('[core.spend_cost_ranges]', error.message);
    return ranges;
  }

  for (const row of (data ?? []) as RangeRow[]) {
    ranges.set(row.operation as OperationName, {
      runs: Number(row.runs),
      lowMicros: Number(row.low_micros),
      medianMicros: Number(row.median_micros),
      highMicros: Number(row.high_micros),
    });
  }
  return ranges;
}

/** One estimate per operation, for a page that shows several buttons. */
export async function estimateOperations(
  supabase: CoreSupabaseClient,
  userId: string,
  operations: readonly OperationName[],
): Promise<Map<OperationName, CostEstimate>> {
  const ranges = await loadCostRanges(supabase, userId, operations);
  return new Map(operations.map((name) => [name, estimateFor(name, ranges.get(name))]));
}

/**
 * Add up the estimates for one press, scaling any part given a count.
 *
 * Pure, so the sum can be tested without a database. A per-unit part with no
 * count stays per unit; the whole is then per unit only if every part is, and
 * the button passes its count to the hint.
 */
export function combineEstimates(
  parts: readonly OperationCount[],
  ranges: ReadonlyMap<OperationName, MeasuredRange>,
): CostEstimate | null {
  return sumEstimates(
    parts.map((part) => {
      const name = typeof part === 'string' ? part : part.operation;
      const estimate = estimateFor(name, ranges.get(name));
      return typeof part === 'string' ? estimate : scaleEstimate(estimate, part.count);
    }),
  );
}

/**
 * What one press of a button will cost: every operation it runs, summed.
 *
 * Null when given no operations. For a Learn import, for example:
 * `estimateCost(core, userId, ['parse-references', { operation:
 * 'resolve-reference', count: 12 }, 'plan-topic'])`.
 */
export async function estimateCost(
  supabase: CoreSupabaseClient,
  userId: string,
  parts: readonly OperationCount[],
): Promise<CostEstimate | null> {
  const names = parts.map((part) => (typeof part === 'string' ? part : part.operation));
  const ranges = await loadCostRanges(supabase, userId, names);
  return combineEstimates(parts, ranges);
}
