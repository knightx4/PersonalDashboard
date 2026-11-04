import { cn } from '@/lib/cn';
import { SEAT_LABELS, type Seat } from '@/lib/you/board';
import { AdvisorAvatar } from './advisor-avatar';

/**
 * A seat's avatar and its name, so the five can be told apart at a glance
 * down a column of positions, predictions or scores (plan #2581.3, in place
 * of the seat icons). `text` replaces the label where the sentence form is
 * wanted.
 */
export function SeatLabel({ seat, text, className }: { seat: Seat; text?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <AdvisorAvatar advisorKey={seat} name={SEAT_LABELS[seat]} decorative />
      {text ?? SEAT_LABELS[seat]}
    </span>
  );
}
