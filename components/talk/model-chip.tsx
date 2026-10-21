'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { chipVariants } from '@/components/ui/chip';
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
}: {
  model: DashChoiceId;
  onModel: (model: DashChoiceId) => void;
  /** For the gallery: the list drawn open. */
  initialOpen?: boolean;
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
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const chip = root.current.getBoundingClientRect();
    const box = (root.current.closest('form') ?? document.body).getBoundingClientRect();
    const width = Math.min(LIST_WIDTH, box.width);
    const left = Math.min(Math.max(chip.left, box.left), box.right - width);
    setPlace({ left: left - chip.left, width });
  }, [open]);
  const label = modelLabel(model);
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Dash answers with ${label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={cn(chipVariants({ tone: 'neutral' }), 'press-area shrink-0 hover:text-ink')}
      >
        <span>{label}</span>
        {/* On a phone too, where Add a file gives up its words to make room (plan #2458.5). */}
        <ChevronDown strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Dash answers with"
          className={cn(popoverSurface, 'absolute bottom-full left-0 z-overlay mb-1.5 w-72 p-1')}
          style={place ? { left: place.left, width: place.width } : undefined}
        >
          <p className="px-2.5 pb-0.5 pt-1 text-small text-ink-muted">Dash answers with</p>
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
