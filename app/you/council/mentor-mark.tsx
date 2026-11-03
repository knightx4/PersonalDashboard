import { cn } from '@/lib/cn';
import { SEATS, type Seat } from '@/lib/you/board';
import { initials } from '@/lib/you/board-questions';
import { SEAT_ICONS } from './seat-label';

/**
 * A mentor's mark on the Council: a seat's icon, or a guest's initials, in a
 * round badge. A guest is a persona Dash built from a person's public work,
 * so the Council never shows a face for one (as the advisor mark, plan
 * #2561.4). `size` is the badge's: small beside a name in a line, large at
 * the head of a tile or a page.
 */
export function MentorMark({
  mentorKey,
  name,
  kind,
  size = 'md',
  className,
}: {
  mentorKey: string;
  name: string;
  kind: 'seat' | 'guest';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const seat = kind === 'seat' && (SEATS as readonly string[]).includes(mentorKey) ? (mentorKey as Seat) : null;
  const Icon = seat ? SEAT_ICONS[seat] : null;
  return (
    <span
      aria-hidden
      className={cn(
        'tabular inline-flex shrink-0 items-center justify-center rounded-pill bg-sunken font-semibold leading-none text-ink',
        size === 'sm' && 'size-5 text-micro',
        size === 'md' && 'size-8 text-small',
        size === 'lg' && 'size-12 text-ui',
        className,
      )}
    >
      {Icon ? (
        <Icon strokeWidth={1.75} className={cn(size === 'sm' ? 'size-3' : size === 'md' ? 'size-4' : 'size-6')} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
