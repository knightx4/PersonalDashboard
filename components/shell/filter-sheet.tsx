'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { scrim } from '@/components/ui/popover';
import { IconButton } from '@/components/ui/icon-button';

/**
 * Filters behind one button at every width, for a list page that is one
 * column on a laptop too (the list-and-detail pattern, plan #1785). Beside
 * the button is what the filters are set to, in words. It takes the same
 * `RailGroup`s as `LeftRail` (components/shell/left-rail.tsx), and opens the
 * same sheet that rail opens below xl, so a filter reads the same whether
 * it sits in a column or behind the button.
 */
export function FilterSheet({
  children,
  summary,
}: {
  children: React.ReactNode;
  /** What the filters are set to, such as "Due soon · Amazon". */
  summary?: string;
}) {
  const [open, setOpen] = useState(false);

  // Every rail item is a link, so opening one is when the sheet should close.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} shrink-0`}
          aria-expanded={open}
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
          Filters
        </button>
        {summary && <span className="min-w-0 truncate text-ui text-ink-muted">{summary}</span>}
      </div>

      {/* Rendered only when open, so it costs nothing at rest. */}
      {open && (
        <div className="fixed inset-0 z-overlay">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
            className={scrim}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-border bg-surface"
            aria-label="Filters"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-ui font-semibold text-ink">Filters</h2>
              <IconButton label="Close filters" onClick={() => setOpen(false)}>
                <X strokeWidth={1.75} aria-hidden />
              </IconButton>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto p-4" onClick={() => setOpen(false)}>
              {children}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
