import { cn } from '@/lib/cn';

/**
 * Twelve months in forty pixels.
 *
 * A share bar answers "how much of this period was this merchant". It cannot
 * answer "is this new, or have I always spent this here", which is the more
 * useful question and the one the row had no room for. This adds it without
 * adding a column.
 *
 * Deliberately unlabelled and unaxed. At this size a sparkline is a shape, not
 * a chart -- rising, falling, spiky, flat -- and anything more would need room
 * it does not have. The accessible name carries the reading for anyone who
 * cannot see the shape.
 */
export function Sparkline({
  values,
  label,
  className,
  width = 52,
  height = 16,
}: {
  /** Oldest first. Every bucket present, including the zeroes. */
  values: readonly number[];
  /** Read aloud instead of the shape. */
  label: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  // One point is a dot, not a line, and zero points is nothing worth drawing.
  const pointCount = values.length;
  if (pointCount < 2) return null;

  const max = Math.max(...values);
  const pad = 1.5;
  const usable = height - pad * 2;
  const step = width / (pointCount - 1);

  // A flat series sits on the baseline rather than halfway up: a merchant with
  // one purchase should not draw a line that looks like steady spending.
  const y = (value: number) =>
    max === 0 ? height - pad : height - pad - (value / max) * usable;

  const points = values.map(
    (value, index) => `${(index * step * ((width - 2) / width)).toFixed(2)},${y(value).toFixed(2)}`,
  );
  const line = `M${points.join('L')}`;
  const area = `${line}L${width - 2},${height}L0,${height}Z`;
  // Inset by the dot's radius so it is not clipped by the viewBox and does not
  // sit flush against the number beside it.
  const lastX = width - 2;
  const lastY = y(values[pointCount - 1]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height + 2}`}
      className={cn('text-accent', className)}
      role="img"
      aria-label={label}
    >
      <path d={area} fill="currentColor" opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Where it ended, which is the point the eye wants. */}
      <circle cx={lastX} cy={lastY} r={1.8} fill="currentColor" />
    </svg>
  );
}
