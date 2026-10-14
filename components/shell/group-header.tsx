import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-heading';

/**
 * The header over one group of rows: what the group is, how many rows are in
 * it, and what they add up to.
 *
 * There were two of these and they disagreed. Inventory drew its category
 * header as a full-strength `text-ui` heading; orders drew its month header as
 * the small uppercase label, which is the spelling the design page names for a
 * header over rows. This is that one, so a list does not change voice when it
 * changes what it groups by.
 *
 * The subtotal is a node the list works out, never a number this adds up:
 * orders total money in the display currency and roles count rows, and money
 * is formatted in `lib/money.ts` and nowhere else. The count is always here,
 * because a group without one is a heading rather than a group.
 */
export function GroupHeader({
  label,
  count,
  subtotal,
  className,
}: {
  label: string;
  count: number;
  /** What the rows come to: formatted money, a duration, or nothing. */
  subtotal?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 px-1', className)}>
      <SectionLabel as="h2" count={count}>
        {label}
      </SectionLabel>
      {subtotal != null && subtotal !== false && (
        <p className="tabular text-small text-ink-muted">{subtotal}</p>
      )}
    </div>
  );
}
