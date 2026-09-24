import {
  estimateFor,
  guessEstimate,
  isBackgroundOperation,
  type MeasuredRange,
} from '@/lib/core/spend/estimate';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { OPERATION_GUESSES, type OperationName } from '@/lib/core/spend/guesses';
import { SPEND_OPERATIONS } from '@/lib/core/spend/operations';

/**
 * Each operation's estimate set beside what it actually cost, for the spend
 * page (plan #920).
 *
 * The estimate is what the $ hint shows before a press: the ledger's median
 * once there are five runs in thirty days, the written guess before that. The
 * actual median comes from the same ledger read over the same thirty days.
 *
 * **For a measured operation the two are the same figure.** The estimate is
 * that median, so setting it against itself says nothing. What such a row can
 * still say is how good the written guess was, which is what every uncertain
 * hint is showing today. So a measured row carries the guess too, and an
 * uncertain row with some runs says whether they landed inside the guess's
 * range (half to twice its figure).
 */

/** What an operation's estimate looks like against its recent runs. */
export type EstimateComparison = {
  module: string;
  operation: OperationName;
  /** What the $ hint shows before a press. */
  estimate: CostEstimate;
  /** The written guess, whatever the estimate is. Equal to it when uncertain. */
  guess: CostEstimate;
  /** The ledger's median over the window; null with no runs in it. */
  actualMicros: number | null;
  /** Runs in the window: presses, or single calls for a per-unit operation. */
  runs: number;
  /**
   * Where the actual median fell against the written guess's range: `above`
   * or `below` it, `within`, or null with nothing to compare.
   */
  guessVerdict: 'above' | 'within' | 'below' | null;
};

/** Every operation the guesses name, in their order, which is by module. */
export const EVERY_OPERATION = Object.keys(OPERATION_GUESSES) as OperationName[];

/** The module an operation's calls are recorded under. Learn owns the rest. */
export function moduleOf(operation: OperationName): string {
  for (const [module, names] of Object.entries(SPEND_OPERATIONS)) {
    if ((names as readonly string[]).includes(operation)) return module;
  }
  return 'learn';
}

export function compareEstimate(
  operation: OperationName,
  measured: MeasuredRange | undefined,
): EstimateComparison {
  const guess = guessEstimate(operation);
  const actualMicros = measured && measured.runs > 0 ? measured.medianMicros : null;
  return {
    module: moduleOf(operation),
    operation,
    estimate: estimateFor(operation, measured),
    guess,
    actualMicros,
    runs: measured?.runs ?? 0,
    guessVerdict:
      actualMicros == null
        ? null
        : actualMicros > guess.highMicros
          ? 'above'
          : actualMicros < guess.lowMicros
            ? 'below'
            : 'within',
  };
}

/** Every operation compared, the ones with a button apart from the background ones. */
export function compareEstimates(ranges: ReadonlyMap<OperationName, MeasuredRange>): {
  foreground: EstimateComparison[];
  background: EstimateComparison[];
} {
  const rows = EVERY_OPERATION.map((name) => compareEstimate(name, ranges.get(name)));
  return {
    foreground: rows.filter((row) => !isBackgroundOperation(row.operation)),
    background: rows.filter((row) => isBackgroundOperation(row.operation)),
  };
}
