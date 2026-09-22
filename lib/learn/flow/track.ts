import { countStates, settledCount, type Graph } from '@/lib/learn/graph/model';

/**
 * Where a track stood before an answer and where it stands after it, as the
 * count of settled ideas out of all of them.
 *
 * The same number the subject page puts under its title, read from the graph
 * on both sides of the answer. It falls as well as rises: a wrong answer can
 * make a settled idea shaky, and a right one can settle the ideas underneath
 * it by inference, so one answer can move it by more than one.
 */
export type TrackMove = {
  before: number;
  settled: number;
  total: number;
};

export function trackMove(before: Graph, after: Graph): TrackMove {
  const counts = countStates(after);
  return {
    before: settledCount(countStates(before)),
    settled: settledCount(counts),
    total: counts.total,
  };
}

/** Width of the bar, as a whole percentage. An empty track draws an empty bar. */
export function trackPercent(settled: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(settled, total) / total) * 100);
}

/** The line under the bar saying what the answer did to it. */
export function trackChange(move: TrackMove): string {
  const delta = move.settled - move.before;
  if (delta === 0) return `Still ${move.settled} of ${move.total} settled.`;
  const size = Math.abs(delta);
  const noun = size === 1 ? 'idea' : 'ideas';
  return delta > 0
    ? `${size} more ${noun} settled, up from ${move.before}.`
    : `${size} ${noun} no longer settled, down from ${move.before}.`;
}
