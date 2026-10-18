/**
 * The arithmetic of the agglomeration model (plan #2321.8), apart from its
 * drawing so the plot and the captions read the same numbers.
 *
 * Output per worker, in thousands of pounds a year, against a city's size N
 * in millions of people:
 *
 *   output(N) = 60 + 3G × ln(1 + N) - cN
 *
 * G is the gains from size, the sum of the sharing, matching and learning
 * sliders (each 0 to 4): every newcomer adds to them, but by less the bigger
 * the city already is. c is congestion, what each million more people costs
 * each worker in longer commutes, dearer housing and crowding. Output per
 * worker peaks where the two cancel, at N = 3G / c - 1, and falls beyond it.
 * The plot runs to 10 million; a peak past it is said to be past it.
 */

export const SIZE_MAX = 10;
export const OUTPUT_MAX = 140;
const BASE = 60;

export type AgglomerationValues = {
  sharing: number;
  matching: number;
  learning: number;
  congestion: number;
};

export function gains(values: AgglomerationValues): number {
  return values.sharing + values.matching + values.learning;
}

export function outputAt(size: number, values: AgglomerationValues): number {
  return BASE + 3 * gains(values) * Math.log(1 + size) - values.congestion * size;
}

/** The size output per worker peaks at, which may lie past the plot; 0 when it only falls. */
export function bestSize(values: AgglomerationValues): number {
  return Math.max(0, (3 * gains(values)) / values.congestion - 1);
}

/** The peak as drawn: inside the plot, with its output. */
export function peak(values: AgglomerationValues): { size: number; output: number; past: boolean } {
  const best = bestSize(values);
  const size = Math.min(best, SIZE_MAX);
  return { size, output: outputAt(size, values), past: best > SIZE_MAX };
}

/** The curve across the plot, every quarter of a million. */
export function curve(values: AgglomerationValues): Array<{ n: number; y: number }> {
  return Array.from({ length: SIZE_MAX * 4 + 1 }, (_, i) => {
    const n = i / 4;
    return { n, y: outputAt(n, values) };
  });
}

/** A size as the page shows it: 5 million, or 2.5 million. */
export function millions(size: number): string {
  const rounded = Math.round(size * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} million`;
}

/** Output per worker as the page shows it: £57k. */
export function thousands(output: number): string {
  return `£${Math.round(output)}k`;
}
