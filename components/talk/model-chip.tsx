'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { chipVariants } from '@/components/ui/chip';
import { QUIET_PICKER } from '@/components/talk/think-switch';
import { menuItemClass, popoverSurface } from '@/components/ui/popover';
import { DASH_CHOICES, type DashChoiceId } from '@/lib/core/models';

/**
 * The chip in Dash's box that says which model answers the next question,
 * and changes it (plan #2458.3). It sits beside the scope chip in the box's
 * foot, in the popup and on the Dash page alike, and its list opens upwards,
 * since the box sits at the foot of the chat. The pick shows at once; the
 * shell's provider saves it and puts the old one back if the save fails.
 */

/** One line on speed and cost for each model, keyed by its label. */
const SAYS: Record<(typeof DASH_CHOICES)[number]['label'], string> = {
  Haiku: 'Fastest and cheapest. Good for quick lookups.',
  Sonnet: 'Quick and mid-priced. Right for most questions.',
  Opus: 'Slowest and costs the most. For hard questions.',
};

/** The list's width, w-72, unless the box is narrower. */
const LIST_WIDTH = 288;

export function modelLabel(model: DashChoiceId): string {
  return DASH_CHOICES.find((c) => c.id === model)?.label ?? 'Sonnet';
}

export function ModelChip({
  model,
  onModel,
  initialOpen = false,
  quiet = false,
  heading = 'Dash answers with',
}: {
  model: DashChoiceId;
  onModel: (model: DashChoiceId) => void;
  /** Plain grey words under the box rather than a chip in its foot (plan #2863). */
  quiet?: boolean;
  /** For the gallery: the list drawn open. */
  initialOpen?: boolean;
  /** Who the pick is for, read before the list and the model: "Bots write with" on the Bots tab. */
  heading?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  // Where the list sits: hung from the chip, but kept inside the question
  // box it belongs to, so it never runs past the box's edges or the
  // screen's, wherever the chip lands in the foot.
  // Quiet under the box (plan #2863), the list rises past the box too, so
  // Send and the words stay in view while a model is picked.
  const [place, setPlace] = useState<{ left: number; width: number; lift: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const chip = root.current.getBoundingClientRect();
    const form = root.current.closest('form') ?? document.body;
    const outer = form.getBoundingClientRect();
    // Inside the form's own padding: on a phone the box held over the tab
    // bar is a form the screen's width, padded in to the page's margin.
    const style = window.getComputedStyle(form);
    const inLeft = outer.left + (parseFloat(style.paddingLeft) || 0);
    const inRight = outer.right - (parseFloat(style.paddingRight) || 0);
    const box = { top: outer.top, left: inLeft, right: inRight, width: inRight - inLeft };
    const width = Math.min(LIST_WIDTH, box.width);
    const left = Math.min(Math.max(chip.left, box.left), box.right - width);
    setPlace({ left: left - chip.left, width, lift: quiet ? Math.max(0, chip.top - box.top) : 0 });
  }, [open, quiet]);
  const label = modelLabel(model);
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${heading} ${label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={quiet ? QUIET_PICKER : cn(chipVariants({ tone: 'neutral' }), 'press-area shrink-0 hover:text-ink')}
      >
        <span>{label}</span>
        {/* On a phone too, where Add a file gives up its words to make room (plan #2458.5). */}
        <ChevronDown strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={heading}
          className={cn(popoverSurface, 'absolute bottom-full left-0 z-overlay mb-1.5 w-72 p-1')}
          style={
            place
              ? { left: place.left, width: place.width, bottom: place.lift ? `calc(100% + ${place.lift}px)` : undefined }
              : undefined
          }
        >
          <p className="px-2.5 pb-0.5 pt-1 text-small text-ink-muted">{heading}</p>
          {DASH_CHOICES.map((choice) => {
            const on = choice.id === model;
            return (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  setOpen(false);
                  if (!on) onModel(choice.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setOpen(false);
                  }
                }}
                className={cn(menuItemClass(), 'min-h-11 items-start sm:min-h-0')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{choice.label}</span>
                  <span className="block text-small text-ink-muted">{SAYS[choice.label]}</span>
                </span>
                {on && (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-accent"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
