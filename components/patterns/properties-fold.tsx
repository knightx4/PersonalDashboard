'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The tabbed detail's properties on a phone (plan #1688): the facts read
 * first in one row, and the rest under "All details", so the tabs are on the
 * first screen. Ten facts as a grid pushed them a full screen down.
 *
 * From laptop width the fold is not there: the column shows every fact, the
 * first ones on top, since the column sits beside the tab and costs it no
 * height.
 */
export function PropertiesFold({
  glance,
  children,
}: {
  /** The two or three facts read first, as `Property`s. */
  glance: React.ReactNode;
  /** The rest, as a `PropertyList`. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const restId = useId();
  return (
    <div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 lg:grid-cols-1 lg:gap-y-2.5">{glance}</dl>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={restId}
        onClick={() => setOpen((was) => !was)}
        className="press -mx-1.5 -mb-1.5 mt-1 inline-flex min-h-11 items-center gap-1 rounded-sm px-1.5 text-small text-ink-muted hover:bg-sunken hover:text-ink lg:hidden"
      >
        {open ? 'Fewer details' : 'All details'}
        <ChevronDown
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      <div
        id={restId}
        className={cn('border-t border-border pt-3 lg:mt-2.5 lg:block lg:pt-2.5', open ? 'mt-1.5' : 'hidden')}
      >
        {children}
      </div>
    </div>
  );
}
