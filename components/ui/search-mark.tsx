import { cn } from '@/lib/cn';

/**
 * The mark for searching everything you own: a ring with a solid dot inside it
 * (plan #1365, as the person asked).
 *
 * It stands in for Lucide's magnifier in the three ways into the search box:
 * the field in the top bar, the search button on a phone and the field row of
 * the box itself. The boxes above a list (search-field.tsx) keep the
 * magnifier, so a search that narrows one list still looks different from the
 * one that searches the whole app.
 *
 * Drawn in a 24 unit box like a Lucide icon, at size-4 unless the caller says
 * otherwise, with the same stroke weight the shell gives its icons. Everything
 * is `currentColor`, so it takes the ink of wherever it sits in either theme.
 */

const BOX = 24;
const C = BOX / 2;
/** The ring, the size of the lens in the magnifier it replaces. */
const RING = 8.5;
/** The dot, small enough to leave a clear band of ground inside the ring. */
const DOT = 3.25;

export function SearchMark({
  className,
  strokeWidth = 1.75,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      fill="none"
      aria-hidden
      focusable="false"
      data-mark="search"
      className={cn('size-4 shrink-0', className)}
    >
      <circle cx={C} cy={C} r={RING} stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx={C} cy={C} r={DOT} fill="currentColor" />
    </svg>
  );
}
