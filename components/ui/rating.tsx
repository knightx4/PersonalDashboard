import { cn } from '@/lib/cn';
import { segmentedFrame } from './segmented';

/**
 * A point on a short scale, as one row of joined buttons (plan #1632).
 *
 * Built on the segmented control's frame and its marking of the choice, the
 * accent tint rather than the fill, so a rated row reads like a chosen mode
 * everywhere else in the app. It differs in two ways a scale needs: the
 * segments share the full width equally, so the points line up from one
 * statement to the next and stay wide enough to press on a phone, and the
 * scale's two ends can be named beneath the row. A long list of rows on the
 * same scale names them once above the list instead, and leaves `low` and
 * `high` out. Each point's full wording is its accessible name and its hover
 * title.
 *
 * Nothing is chosen until it is pressed: `value` is null for an unanswered
 * row, which is what lets a long list show what is left.
 */
export function Rating({
  value,
  scale,
  onChange,
  label,
  low,
  high,
  disabled = false,
  className,
}: {
  value: number | null;
  /** The points, in order from `low` to `high`. */
  scale: ReadonlyArray<{ value: number; label: string }>;
  onChange: (value: number) => void;
  /** Names the question the row answers, for the accessibility tree. */
  label: string;
  /** What the first point means, written under it. */
  low?: string;
  /** What the last point means, written under it. */
  high?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)}>
      <span role="group" aria-label={label} className={cn(segmentedFrame, 'flex w-full')}>
        {scale.map((point, index) => {
          const on = point.value === value;
          return (
            <button
              key={point.value}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              aria-label={point.label}
              title={point.label}
              onClick={() => onChange(point.value)}
              className={cn(
                'press inline-flex h-(--control-h) flex-1 items-center justify-center text-ui font-medium tabular-nums',
                'transition-colors duration-quick disabled:pointer-events-none disabled:opacity-50',
                'focus-visible:outline-2 focus-visible:-outline-offset-2',
                index > 0 && 'border-l border-control',
                on
                  ? 'bg-accent-tint text-accent'
                  : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
              )}
            >
              {index + 1}
            </button>
          );
        })}
      </span>
      {low || high ? (
        <span className="mt-1 flex justify-between gap-3 text-small text-ink-muted" aria-hidden>
          <span>{low}</span>
          <span className="text-right">{high}</span>
        </span>
      ) : null}
    </div>
  );
}
