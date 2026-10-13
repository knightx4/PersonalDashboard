'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The small + on a calendar day that starts a new event on it, with its
 * tooltip. A client component of its own: the month and week grids are
 * server components, and the Tooltip wrapped round a link there failed to
 * render on the month grid (the element came back undefined), while the
 * same pair drawn from a client module renders.
 */
export function NewEventLink({
  href,
  day,
  className,
  linkClassName,
  align,
}: {
  href: string;
  /** The day, as YYYY-MM-DD, for the accessible name. */
  day: string;
  /** Where the control sits in its square. */
  className?: string;
  linkClassName?: string;
  align?: 'start' | 'end';
}) {
  return (
    <Tooltip label="New event on this day" align={align} className={className}>
      <Link
        href={href}
        aria-label={`New event on ${day}`}
        className={cn(
          'press flex size-5 shrink-0 items-center justify-center rounded-full text-ink-ghost hover:bg-accent-tint hover:text-accent',
          linkClassName,
        )}
      >
        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
      </Link>
    </Tooltip>
  );
}
