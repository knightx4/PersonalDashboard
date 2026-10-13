'use client';

import Link from '@/components/ui/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { CalendarView } from '@/lib/todo/calendar/range';

/**
 * One arrow of the calendar's stepper, with its tooltip. A client module, as
 * the + on the grids is, for the reason given in
 * components/todo/new-event-link.tsx.
 */
export function StepLink({
  view,
  date,
  direction,
}: {
  view: CalendarView;
  date: string;
  direction: 'previous' | 'next';
}) {
  const label = `${direction === 'previous' ? 'Previous' : 'Next'} ${view}`;
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <Tooltip label={label}>
      <Link
        href={{ pathname: '/todo/calendar', query: { view, date } }}
        aria-label={label}
        className={iconButtonVariants({ size: 'md' })}
      >
        <Icon strokeWidth={1.75} aria-hidden />
      </Link>
    </Tooltip>
  );
}
