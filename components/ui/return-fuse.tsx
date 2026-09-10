import { cn } from '@/lib/cn';
import { HEALTH_STATES, deadlineHealth } from '@/lib/health';
import { deadlineLabel } from '@/lib/returns/deadline';

/**
 * How much of a return window is left, as a length.
 *
 * "Returns by 14 Sept" asks you to subtract today from a date, every time you
 * scan the row. A bar that empties as the window closes is the same fact
 * without the arithmetic, and the eye reads a dozen of them in the time it
 * takes to read one date.
 *
 * The denominator is the merchant's real window, not a fixed horizon: a fuse
 * against an invented length would be a picture of a number nobody has. Where
 * the window is unknown there is no bar at all, for the same reason -- the
 * app does not draw precision it does not have, and `deadlineHealth` returns
 * no state for exactly that case.
 *
 * Colour comes from the health states in `lib/health.ts`, which is also where
 * the row's words and the "Due soon" filter get their thresholds, so the bar
 * and the text beside it cannot disagree.
 */
export function ReturnFuse({
  daysLeft,
  windowDays,
  deadline,
  className,
}: {
  daysLeft: number | null;
  /** The merchant's window. Null means we do not know, and nothing is drawn. */
  windowDays: number | null;
  deadline: string | null;
  className?: string;
}) {
  const health = deadlineHealth(daysLeft, windowDays);
  if (health === null || daysLeft === null || windowDays === null) return null;

  // Burnt out reads as full-and-wrong rather than empty-and-absent: an empty
  // track looks like a bar that has not loaded.
  const fraction =
    health === 'overdue' ? 1 : Math.min(1, Math.max(0, daysLeft / windowDays));

  return (
    <span
      className={cn('block h-[3px] w-full overflow-hidden rounded-full bg-sunken', className)}
      role="img"
      aria-label={deadline ? deadlineLabel(daysLeft, deadline) : undefined}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-500',
          HEALTH_STATES[health].fill,
        )}
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </span>
  );
}
