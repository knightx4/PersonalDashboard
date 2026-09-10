import { cn } from '@/lib/cn';

/**
 * One quantity drawn as a length, against the quantity it is part of.
 *
 * Five surfaces drew this by hand -- the merchant and person breakdowns, the
 * jobs funnel, the rejection split, and a feature's progress on the plan --
 * and they differed only in height and in which colour filled them. The bars
 * themselves are the same claim every time: this much of that.
 *
 * There is no number inside the bar and no axis under it. A meter sits beside
 * the figure it draws, which is where the exact value is read; the length is
 * for comparing the rows to each other in one pass. The accessible name says
 * both halves of the claim, so it is not the shape that has to be seen.
 */
export function Meter({
  value,
  max,
  label,
  fill = 'bg-accent',
  track = 'canvas',
  height = 'sm',
  minFraction = 0,
  className,
}: {
  value: number;
  /** What the value is part of. A max of zero draws an empty track. */
  max: number;
  /** Read aloud in place of the bar: "Amazon: $340 of $1,843". */
  label: string;
  /** Any background utility. The colour is a claim, so the caller owns it. */
  fill?: string;
  /**
   * `canvas` on a card, `sunken` on the page ground -- `--c-page` is
   * `var(--c-canvas)`, so a canvas track on a page is the page colour and
   * there is no visible track at all.
   */
  track?: 'canvas' | 'sunken';
  height?: 'sm' | 'md';
  /**
   * The smallest length a non-zero value may draw, as a fraction. One
   * application out of four hundred is still a row that happened, and a bar
   * too short to see says it did not.
   */
  minFraction?: number;
  className?: string;
}) {
  const fraction = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const drawn = value > 0 ? Math.max(fraction, minFraction) : fraction;

  return (
    <span
      className={cn(
        'block w-full overflow-hidden rounded-full',
        height === 'md' ? 'h-2' : 'h-1.5',
        track === 'sunken' ? 'bg-sunken' : 'bg-canvas',
        className,
      )}
      role="img"
      aria-label={label}
    >
      <span
        className={cn('block h-full rounded-full', fill)}
        style={{ width: `${Math.round(drawn * 100)}%` }}
      />
    </span>
  );
}
