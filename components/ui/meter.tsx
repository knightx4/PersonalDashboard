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

/** One stretch of a banded bar: how much, in what colour, called what. */
export type Band = {
  /** Stable across a render. */
  key: string;
  value: number;
  /** Any background utility. The colour is a claim, so the caller owns it. */
  fill: string;
  /** This band alone: "3 blocked". Read on hover and in the bar's own name. */
  label: string;
};

/**
 * The whole of something, split into the states it is in.
 *
 * A `Meter` is one quantity against another and answers "how far through".
 * This answers the question directly underneath that one -- how far through
 * *and into what* -- by spending the entire length rather than filling part of
 * a blank track: eleven steps nobody has started and eleven questions waiting
 * on an answer are the same `Meter` and are two very different bars here.
 *
 * The bands are drawn in the order given and never sorted by size, so the
 * picture stays comparable to the one from last week. The caller owns both the
 * order and the colours, because which states there are and what they mean is
 * not something a bar can know.
 *
 * Laid out by flex-grow rather than by width percentages, so a band can be
 * given a floor -- one blocked step in forty is about half a pixel wide and a
 * band too thin to see says it is not there -- without the row overflowing:
 * the floor is taken out of the bands that have length to spare, and they stay
 * proportional to each other.
 *
 * The bar is one image to a screen reader, named with every band in turn. A
 * row of eight unlabelled slivers is not something to make somebody tab
 * through, and the counts are written out beside it anyway.
 */
export function Bands({
  bands,
  label,
  track = 'canvas',
  height = 'sm',
  className,
}: {
  bands: readonly Band[];
  /** What the whole bar is of: "Shopping". The bands finish the sentence. */
  label: string;
  track?: 'canvas' | 'sunken';
  height?: 'sm' | 'md';
  className?: string;
}) {
  const drawn = bands.filter((band) => band.value > 0);

  return (
    <span
      className={cn(
        'flex w-full overflow-hidden rounded-full',
        height === 'md' ? 'h-2' : 'h-1.5',
        track === 'sunken' ? 'bg-sunken' : 'bg-canvas',
        className,
      )}
      role="img"
      aria-label={
        drawn.length === 0 ? label : `${label}: ${drawn.map((band) => band.label).join(', ')}`
      }
    >
      {drawn.map((band) => (
        <span
          key={band.key}
          className={cn('block h-full', band.fill)}
          title={band.label}
          style={{ flex: `${band.value} 1 0`, minWidth: '3px' }}
        />
      ))}
    </span>
  );
}
