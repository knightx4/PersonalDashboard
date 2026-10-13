'use client';

import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { createTooltipController } from '@/lib/tooltip-controller';

/**
 * A short label for an icon or a badge that cannot say what it is on its own.
 *
 * It wraps one child. Hovering with a mouse, or tabbing onto the child, shows
 * the label after a short delay; moving the pointer off, blurring or pressing
 * Escape hides it. This is CostHint's *peek* and nothing more: the same
 * `role="tooltip"` on the shared `Popover` surface, the same mouse-only hover
 * (a tap has no hover, so touch never opens it), the same `:focus-visible`
 * test so a click does not leave one showing, and the same Escape that stops
 * at the tooltip instead of also closing whatever panel the child sits in.
 * CostHint's second mode, the pinned dialog, is not here: a tooltip holds
 * nothing to interact with.
 *
 * The child keeps its own `aria-label` as its accessible name. The tooltip
 * adds `aria-describedby` while it shows, so a screen reader hears the label
 * and then the tip. Tip text that only repeats the label wants no Tooltip.
 *
 * The child must be a single element that takes `aria-describedby` (a button,
 * a link, a span with a tabindex). A badge that cannot be focused is not
 * reachable by keyboard; give it `tabIndex={0}` or leave the tip off it.
 */
export function Tooltip({
  label,
  children,
  align = 'start',
  defaultOpen = false,
  className,
}: {
  /** The tip's text. Keep it to a few words. */
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  /** Which edge of the child the tip hangs from; `end` near a row's right edge. */
  align?: 'start' | 'end';
  /** Start showing. For the preview gallery's shots. */
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const [controller] = useState(() => createTooltipController({ onChange: setOpen, initiallyOpen: defaultOpen }),
  );
  useEffect(() => () => controller.hide(), [controller]);

  // Kept on screen, as CostHint's popup is: moved back in by what it
  // overhangs, keeping the 16px gutter. `translate` rather than `transform`,
  // which the rise-in animation owns.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    panel.style.translate = '';
    const gutter = 16;
    const rect = panel.getBoundingClientRect();
    const room = document.documentElement.clientWidth;
    let shift = Math.min(0, room - gutter - rect.right);
    if (rect.left + shift < gutter) shift = gutter - rect.left;
    if (shift !== 0) panel.style.translate = `${shift}px 0`;
  }, [open]);

  const ask = () => controller.ask();
  const hide = () => controller.hide();

  return (
    <span
      className={cn('relative inline-flex items-center', className)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') ask();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') hide();
      }}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(':focus-visible')) ask();
      }}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && controller.isOpen()) {
          event.stopPropagation();
          hide();
        }
      }}
    >
      {cloneElement(children, open ? { 'aria-describedby': tipId } : {})}
      {open && (
        <Popover
          ref={panelRef}
          id={tipId}
          role="tooltip"
          anchor={align === 'end' ? 'trigger-below-end' : 'trigger-below'}
          className="w-max max-w-64 px-3 py-2 text-small text-ink"
        >
          {label}
        </Popover>
      )}
    </span>
  );
}
