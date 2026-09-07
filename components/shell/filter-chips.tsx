import Link from 'next/link';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type FilterChip = {
  /** What the filter is, so the row reads without the rail. */
  label: string;
  /** The value in force. */
  value: string;
  /** Where clicking the cross goes: this view without this filter. */
  clearHref: string;
};

/**
 * What is currently narrowing this page, and how to stop it.
 *
 * Inventory can carry seven filters at once -- search, category, merchant,
 * list, date range, sort, grouping and whose -- and until now the only way to
 * see which were applied was to scroll the rail hunting for a tinted row. A
 * filtered view that does not say it is filtered is how "my thing has
 * disappeared" happens.
 *
 * Renders nothing when nothing is filtered, which is the same rule the rest of
 * the app follows: a quiet page should look quiet.
 */
export function FilterChips({
  chips,
  clearAllHref,
  className,
}: {
  chips: FilterChip[];
  clearAllHref: string;
  className?: string;
}) {
  if (chips.length === 0) return null;

  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-1.5', className)}>
      {chips.map((chip) => (
        <Link
          key={`${chip.label}:${chip.value}`}
          href={chip.clearHref}
          className="press group inline-flex items-center gap-1.5 rounded-full bg-accent-tint py-1 pl-2.5 pr-1.5 text-small font-medium text-accent transition-colors hover:bg-accent hover:text-surface"
        >
          <span className="text-accent/70 group-hover:text-surface/70">{chip.label}</span>
          <span className="max-w-40 truncate">{chip.value}</span>
          <X className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
          <span className="sr-only">Remove the {chip.label} filter</span>
        </Link>
      ))}
      {chips.length > 1 && (
        <Link
          href={clearAllHref}
          className="ml-1 text-small font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Clear all
        </Link>
      )}
    </div>
  );
}
