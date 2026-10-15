'use client';

import { useEffect } from 'react';
import { CloseButton } from '@/components/inbox/close-button';
import { cardVariants } from '@/components/ui/card';
import { menuItemClass, popoverSurface } from '@/components/ui/popover';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { LIFECYCLE_GLYPH, LIFECYCLE_VERB } from '@/lib/core/lifecycle';

const nothing = () => undefined;

function Line({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-body break-words text-ink">{title}</p>
        <p className="text-small break-words text-ink-muted">{meta}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** The toast a Drop leaves, held open for the shot. */
function DroppedToast() {
  const toast = useToast();
  useEffect(() => {
    toast({ text: 'Dropped', undo: nothing, duration: 600_000 });
  }, [toast]);
  return null;
}

/**
 * The four words that close a row (plan #1957.3), each with its glyph: Done
 * and Later on a Jobs nudge, Decline on something Dash suggested, Drop on the
 * person's own row, the same four as icons in a row of controls and as menu
 * entries, and the toast every one of them leaves, with Undo.
 */
export function CloseButtonRows() {
  return (
    <ToastProvider>
      <div className="space-y-4 pb-20">
        <div className={cn(cardVariants(), 'divide-y divide-border')}>
          <Line
            title="Follow up with Northwind Analytics about the take-home exercise they sent on Monday"
            meta="Nudge · due today"
          >
            <CloseButton lifecycle="later" />
            <CloseButton lifecycle="done" variant="secondary" />
          </Line>
          <Line title="Staff Product Designer, Tessellate Health" meta="Dash suggested this role · 82 fit">
            <CloseButton lifecycle="declined" />
          </Line>
          <Line title="Book the boiler service before the first cold week" meta="Your to-do · Thursday">
            <CloseButton lifecycle="dropped" />
            <CloseButton lifecycle="done" variant="secondary" />
          </Line>
          <Line title="Renew the passport" meta="Icons in a row of controls">
            <CloseButton compact lifecycle="done" label="Renew the passport" />
            <CloseButton compact lifecycle="later" label="Renew the passport" />
            <CloseButton compact lifecycle="dropped" label="Renew the passport" />
            <CloseButton compact lifecycle="declined" label="Renew the passport" />
          </Line>
        </div>
        <div className="flex justify-end">
          <div role="menu" aria-label="More actions" className={cn(popoverSurface, 'w-48 overflow-hidden p-1')}>
            {(['later', 'dropped'] as const).map((lifecycle) => (
              <button key={lifecycle} type="button" role="menuitem" className={menuItemClass(false)}>
                <span className="flex items-center gap-2">
                  <StatusGlyph glyph={LIFECYCLE_GLYPH[lifecycle]} />
                  {LIFECYCLE_VERB[lifecycle]}
                </span>
              </button>
            ))}
            <button type="button" role="menuitem" className={menuItemClass(false)}>
              Edit everything
            </button>
          </div>
        </div>
      </div>
      <DroppedToast />
    </ToastProvider>
  );
}
