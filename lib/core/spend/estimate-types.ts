/**
 * What a paid button expects to cost, in the shape the $ hint draws.
 *
 * The hint (components/ui/cost-hint.tsx) takes one of these already worked
 * out and never fetches its own. The estimator that fills it in from the
 * spend ledger returns exactly this shape, so the two only meet here.
 *
 * All figures are micro-dollars (millionths), the ledger's own unit, because
 * a single Haiku call is a fraction of a cent.
 */
export type CostEstimate = {
  /** The low end of the usual range: what a cheap run costs. */
  lowMicros: number;
  /** The typical run. The hint's headline figure. */
  medianMicros: number;
  /** The high end of the usual range: what an expensive run costs. */
  highMicros: number;
  /** How many recorded runs the figures come from. Zero for a pure guess. */
  runs: number;
  /**
   * `measured` when there were enough recent runs to trust the range (five
   * in thirty days); `guess` when the figure is a best guess from token
   * counts and prices, which the hint labels uncertain.
   */
  basis: 'measured' | 'guess';
  /**
   * `run` when the figures are for one press of the button; `unit` when they
   * are for one item and the press does several, such as one reading in a
   * batch of twelve. A per-unit estimate is multiplied by the count the
   * button passes.
   */
  per: 'run' | 'unit';
};

/** A per-unit estimate times the count; a per-run one is returned as it is. */
export function scaleEstimate(estimate: CostEstimate, count: number | undefined): CostEstimate {
  if (estimate.per !== 'unit' || count == null) return estimate;
  const n = Math.max(0, count);
  return {
    ...estimate,
    lowMicros: estimate.lowMicros * n,
    medianMicros: estimate.medianMicros * n,
    highMicros: estimate.highMicros * n,
    per: 'run',
  };
}

/**
 * One estimate for a button that runs several operations.
 *
 * The ends and the middle are added, which overstates the spread a little
 * (two operations are rarely both at their worst) and is the safe side for a
 * figure shown before spending money. The whole is measured only when every
 * part is, and it counts the runs of its least-measured part, because that is
 * the part the range is least sure of.
 */
export function sumEstimates(estimates: readonly CostEstimate[]): CostEstimate | null {
  if (estimates.length === 0) return null;
  return {
    lowMicros: estimates.reduce((sum, e) => sum + e.lowMicros, 0),
    medianMicros: estimates.reduce((sum, e) => sum + e.medianMicros, 0),
    highMicros: estimates.reduce((sum, e) => sum + e.highMicros, 0),
    runs: Math.min(...estimates.map((e) => e.runs)),
    basis: estimates.every((e) => e.basis === 'measured') ? 'measured' : 'guess',
    per: estimates.every((e) => e.per === 'unit') ? 'unit' : 'run',
  };
}

/**
 * A cost as the hint says it: to the cent, since it is approximate, and
 * "under a cent" rather than "$0.00", which would read as free.
 */
export function approxDollars(micros: number): string {
  if (micros < 10_000) return 'under a cent';
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * The sentence in the hint's popup.
 *
 * Measured: "About $0.40, usually $0.30 to $0.76, from 12 runs".
 * A guess:  "About $0.05, uncertain".
 */
export function costHintText(estimate: CostEstimate, count?: number): string {
  const scaled = scaleEstimate(estimate, count);
  const about = approxDollars(scaled.medianMicros);
  const head = about === 'under a cent' ? 'Under a cent' : `About ${about}`;
  if (scaled.basis === 'guess') return `${head}, uncertain`;

  const low = approxDollars(scaled.lowMicros);
  const high = approxDollars(scaled.highMicros);
  const range = low === high ? '' : `, usually ${low} to ${high}`;
  const runs = `${scaled.runs} ${scaled.runs === 1 ? 'run' : 'runs'}`;
  return `${head}${range}, from ${runs}`;
}
