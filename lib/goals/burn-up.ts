import type { ScopeDay } from '@/lib/goals/scope-days';

/** Fewest days the chart is drawn for; two points are a slope, not a trend (plan #1837). */
export const BURN_UP_MIN_DAYS = 3;

const DAY_MS = 86_400_000;

export type BurnUpPoint = { x: number; total: number; done: number; day: string };

export type BurnUp = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  points: BurnUpPoint[];
  /** SVG paths for the total and the done line, in the same space as the points. */
  totalPath: string;
  donePath: string;
  /** Top of the scale: the largest total, never below 1. */
  high: number;
  /** y of a count in the chart's own space. */
  y: (count: number) => number;
};

/**
 * The saved days as two lines against one scale that starts at zero. Null
 * under three days, so a page draws nothing rather than a stub. Days come in
 * oldest first (loadScopeDays); x follows the calendar, so a gap in the
 * saved days is a longer stretch of line, not a squeeze.
 */
export function burnUp(
  days: readonly ScopeDay[],
  { width, height }: { width: number; height: number },
): BurnUp | null {
  if (days.length < BURN_UP_MIN_DAYS) return null;

  const plot = { left: 8, right: width - 8, top: 10, bottom: height - 10 };
  const high = Math.max(1, ...days.map((d) => d.total));
  const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
  const first = at(days[0].day);
  const span = at(days[days.length - 1].day) - first;
  const x = (iso: string) =>
    span <= 0
      ? (plot.left + plot.right) / 2
      : plot.left + ((at(iso) - first) / span) * (plot.right - plot.left);
  const y = (count: number) => plot.bottom - (count / high) * (plot.bottom - plot.top);

  const points = days.map((d) => ({ x: x(d.day), total: d.total, done: d.done, day: d.day }));
  const line = (pick: (p: BurnUpPoint) => number) =>
    `M${points.map((p) => `${p.x.toFixed(2)},${y(pick(p)).toFixed(2)}`).join('L')}`;

  return {
    width,
    height,
    plot,
    points,
    totalPath: line((p) => p.total),
    donePath: line((p) => p.done),
    high,
    y,
  };
}

/** The reading a screen reader gets in place of the shape. */
export function burnUpLabel(days: readonly ScopeDay[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  return (
    `Steps over ${days.length} days: from ${first.done} of ${first.total} done on ${first.day} ` +
    `to ${last.done} of ${last.total} done on ${last.day}`
  );
}
