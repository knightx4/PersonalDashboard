import { BurnUpChart } from '@/components/ui/burn-up-chart';
import type { ScopeDay } from '@/lib/goals/scope-days';

/**
 * The burn-up chart drawn from fixtures for the gallery (plan #1837): a
 * month of days with scope added three times, a short run at the three-day
 * floor, and two days, which draw nothing. The page-level surfaces carry the
 * month too, in place.
 */

function build(start: string, rows: readonly (readonly [number, number])[]): ScopeDay[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  return rows.map(([total, done], index) => ({
    day: new Date(from + index * 86_400_000).toISOString().slice(0, 10),
    total,
    done,
  }));
}

/** Thirty days: steps added early and midway, then a push to finish. */
export const MONTH_DAYS: ScopeDay[] = build('2026-09-12', [
  [6, 0], [6, 0], [8, 1], [8, 1], [8, 2], [8, 2], [8, 2], [12, 3], [12, 3], [12, 4],
  [12, 4], [12, 4], [14, 5], [14, 5], [14, 6], [14, 6], [14, 6], [14, 7], [15, 7], [15, 8],
  [15, 8], [15, 9], [15, 9], [17, 9], [17, 10], [17, 11], [17, 12], [17, 13], [17, 14], [17, 15],
]);

export const THREE_DAYS: ScopeDay[] = build('2026-10-09', [
  [4, 0],
  [4, 1],
  [5, 1],
]);

export const TWO_DAYS: ScopeDay[] = build('2026-10-11', [
  [4, 1],
  [4, 2],
]);

export function BurnUpSurface() {
  return (
    <div className="space-y-6">
      <BurnUpChart days={MONTH_DAYS} />
      <BurnUpChart days={THREE_DAYS} />
      <p className="px-1 text-small text-ink-muted">
        Below this line a goal with two days of counts: nothing is drawn.
      </p>
      <BurnUpChart days={TWO_DAYS} />
    </div>
  );
}
