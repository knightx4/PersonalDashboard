'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * One status group in a Steps tab's By status view: a heading row with its
 * count, then its rows (plan #1665). Shared by a feature's page on /dev/plan
 * and a goal's page, so the two read alike.
 *
 * The heading folds the group; done and dropped start folded, and a folded
 * group opens by itself when the address names one of its rows, by the
 * anchor ids in `anchors`.
 */
export function StepGroupRows({
  label,
  count,
  folded,
  anchors,
  children,
}: {
  label: string;
  count: number;
  folded: boolean;
  /** The anchor id of each row in the group. */
  anchors: readonly string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!folded);
  const named = anchors.join(' ');
  useEffect(() => {
    if (!folded) return;
    const openIfNamed = () => {
      const hash = window.location.hash.slice(1);
      if (!named.split(' ').includes(hash)) return;
      setOpen(true);
      // The browser looked for the row before the group was open to hold it.
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    };
    openIfNamed();
    window.addEventListener('hashchange', openIfNamed);
    return () => window.removeEventListener('hashchange', openIfNamed);
  }, [folded, named]);
  return (
    <>
      {/* Every heading folds, so the names share one edge, after the arrow,
          in line with the step numbers beneath them. */}
      <li className="bg-sunken px-3 py-1.5 text-small font-semibold text-ink">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="press press-area inline-flex items-center gap-1.5"
        >
          <ChevronRight
            className={cn('size-3.5 text-ink-muted transition-transform', open && 'rotate-90')}
            strokeWidth={2}
            aria-hidden
          />
          <span>{label}</span>
          <span className="tabular font-normal text-ink-muted">{count}</span>
        </button>
      </li>
      {open && children}
    </>
  );
}
