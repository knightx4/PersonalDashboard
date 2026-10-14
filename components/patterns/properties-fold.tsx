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
  count,
  children,
}: {
  /** The two or three facts read first, as `Property`s. */
  glance: React.ReactNode;
  /** How many facts the fold holds, said on it while it is closed. */
  count?: number;
  /** The rest, as a `PropertyList`. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const restId = useId();
  // A fold over one fact costs a row and a press to hide a single value, so
  // on a phone that fact joins the row instead and there is no fold.
  if (count === 1) {
    return (
      <div className="max-lg:grid max-lg:grid-cols-3 max-lg:gap-x-4 max-lg:gap-y-3">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 max-lg:contents lg:grid-cols-1 lg:gap-y-2.5">
          {glance}
        </dl>
        <div className="max-lg:contents lg:mt-2.5 lg:border-t lg:border-border lg:pt-2.5 max-lg:[&>dl]:contents">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 lg:grid-cols-1 lg:gap-y-2.5">{glance}</dl>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={restId}
        onClick={() => setOpen((was) => !was)}
        className="press -mx-1.5 -mb-1.5 mt-1 inline-flex min-h-11 items-center gap-1 rounded-control px-1.5 text-small text-ink-muted hover:bg-sunken hover:text-ink lg:hidden"
      >
        {open ? 'Fewer details' : count ? `All details · ${count}` : 'All details'}
        <ChevronDown
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
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
