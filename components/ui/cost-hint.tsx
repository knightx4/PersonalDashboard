'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';
import { cn } from '@/lib/cn';
import { costHintText, type CostEstimate } from '@/lib/core/spend/estimate-types';

/**
 * The $ beside a button that costs money to press.
 *
 * It sits next to the button the way an info mark would, and says what one
 * press is expected to cost: "About $0.40, usually $0.30 to $0.76, from 12
 * runs" when the spend ledger has enough runs to know, "About $0.05,
 * uncertain" when it does not.
 *
 * It takes the estimate already worked out (lib/core/spend/estimate-types.ts)
 * and fetches nothing, so a page that has several paid buttons asks for all
 * their estimates once rather than once per hint.
 *
 * -- Two ways open --
 * Hovering with a mouse, or tabbing onto it, *peeks*: the figure shows as a
 * tooltip and goes away when the pointer or the focus leaves. Nothing moves
 * focus, so tabbing past it on the way to the button costs one stop and no
 * detour.
 *
 * Pressing it (a click, a tap, Enter or Space) *pins* it: the popup stays
 * until escape, an outside click or a second press, with focus moved into it
 * and returned afterwards through the same `usePopover` every other panel
 * uses. A tap has no hover, so on a phone this is the only way it opens.
 */
export function CostHint({
  estimate,
  count,
  what,
  align = 'start',
  defaultOpen = false,
  className,
}: {
  estimate: CostEstimate;
  /** How many items the press works on, for an estimate that is per unit. */
  count?: number;
  /** What the button does, for a screen reader: "Cost of drafting the letter". */
  what?: string;
  /** Which edge of the $ the popup hangs from; `end` for a hint at a row's right. */
  align?: 'start' | 'end';
  /** Start with the figure showing, as a peek. For the preview gallery's shots. */
  defaultOpen?: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<'closed' | 'peek' | 'pinned'>(
    defaultOpen ? 'peek' : 'closed',
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Closing a pinned popup hands focus back to the $, and that focus must not
  // reopen it as a peek. Cleared on the next tick, after the handback.
  const justClosed = useRef(false);
  function unpin() {
    justClosed.current = true;
    window.setTimeout(() => {
      justClosed.current = false;
    }, 0);
    setMode('closed');
  }

  usePopover({ open: mode === 'pinned', onClose: unpin, panelRef, triggerRef });

  // Kept on screen. The popup hangs from the $, and a $ halfway across a
  // phone leaves less room to its right than the sentence needs, so the
  // measured sentence ran off the edge and widened the page. It is moved
  // back in by what it overhangs, keeping the 16px gutter. `translate`
  // rather than `transform`, which the rise-in animation owns.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (mode === 'closed' || !panel) return;
    panel.style.translate = '';
    const gutter = 16;
    const rect = panel.getBoundingClientRect();
    const room = document.documentElement.clientWidth;
    let shift = Math.min(0, room - gutter - rect.right);
    if (rect.left + shift < gutter) shift = gutter - rect.left;
    if (shift !== 0) panel.style.translate = `${shift}px 0`;
  }, [mode]);

  const text = costHintText(estimate, count);
  const label = what ? `${what}: ${text}` : `Expected cost: ${text}`;

  function peek() {
    if (mode === 'closed') setMode('peek');
  }
  function unpeek() {
    if (mode === 'peek') setMode('closed');
  }

  return (
    <span
      className={cn('relative inline-flex items-center', className)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') peek();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') unpeek();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={mode === 'pinned'}
        aria-describedby={mode === 'peek' ? panelId : undefined}
        onClick={() => (mode === 'pinned' ? unpin() : setMode('pinned'))}
        onFocus={(event) => {
          if (justClosed.current) return;
          if (event.currentTarget.matches(':focus-visible')) peek();
        }}
        onBlur={unpeek}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && mode === 'peek') {
            event.stopPropagation();
            setMode('closed');
          }
        }}
        className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
      >
        <CircleDollarSign className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>

      {mode !== 'closed' && (
        <Popover
          ref={panelRef}
          id={panelId}
          role={mode === 'peek' ? 'tooltip' : 'dialog'}
          aria-label={mode === 'pinned' ? label : undefined}
          tabIndex={-1}
          anchor={align === 'end' ? 'trigger-below-end' : 'trigger-below'}
          className="w-max max-w-64 px-3 py-2 text-small text-ink outline-none"
        >
          {text}
        </Popover>
      )}
    </span>
  );
}
