import { cn } from '@/lib/cn';

/**
 * How much a story matters, out of 100 (lib/news/issues/importance.ts), as a
 * card shows it at the end of its sender line. Nothing is drawn for a story
 * not yet rated.
 */
export function StoryRating({ rating, className }: { rating?: number | null; className?: string }) {
  if (rating === undefined || rating === null) return null;
  return (
    <span
      className={cn('shrink-0 text-ui tabular-nums text-ink-muted', className)}
      title="How much this story matters, out of 100"
      aria-label={`Importance ${rating} out of 100`}
    >
      <span className="text-ink">{rating}</span>/100
    </span>
  );
}
