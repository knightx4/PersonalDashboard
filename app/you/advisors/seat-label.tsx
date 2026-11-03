import { BriefcaseBusiness, Compass, ScanSearch, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SEAT_LABELS, type Seat } from '@/lib/you/board';

/**
 * Each seat's icon, so the five can be told apart at a glance down a
 * column of positions, predictions or scores. Distinct shapes rather than
 * colours, so they read the same in both themes and to anyone who cannot
 * tell the colours apart.
 */
export const SEAT_ICONS: Record<Seat, LucideIcon> = {
  hiring_manager: BriefcaseBusiness,
  mentor: Compass,
  skeptic: ScanSearch,
  cfo: Wallet,
  dreamer: Sparkles,
};

/** A seat's icon and its name; `text` replaces the label where the sentence form is wanted. */
export function SeatLabel({ seat, text, className }: { seat: Seat; text?: string; className?: string }) {
  const Icon = SEAT_ICONS[seat];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon aria-hidden className="size-[1em] shrink-0" />
      {text ?? SEAT_LABELS[seat]}
    </span>
  );
}
