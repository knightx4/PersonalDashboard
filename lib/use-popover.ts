'use client';

import { useEffect, useRef } from 'react';

/**
 * The popover contract, in one place.
 *
 * Escape and outside-click were already handled correctly in three separate
 * components. What none of them did was the keyboard half: focus was never
 * moved into the panel, never trapped while it was open, and never returned to
 * the trigger on close -- so a keyboard user opening the notifications panel
 * was left several tab stops behind it with no way back.
 *
 * The deferred listener attach is load-bearing: bound synchronously, the very
 * click that opened the panel is the click that closes it again.
 */
export function usePopover({
  open,
  onClose,
  panelRef,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  // Read through a ref so the effect below does not re-bind on every render of
  // a parent that passes a fresh closure. Written in its own effect rather
  // than during render: a ref mutated while rendering is a tear waiting for
  // concurrent React to find it.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    // Captured now: by cleanup time the ref may point somewhere else.
    const trigger = triggerRef?.current ?? null;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first thing worth focusing, or the panel itself, so a screen
    // reader starts reading here rather than back at the trigger.
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    const first = focusables()[0];
    if (first) first.focus();
    else panel?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === firstItem || active === panel)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (trigger?.contains(target)) return;
      onCloseRef.current();
    }

    document.addEventListener('keydown', onKeyDown, true);
    const timer = window.setTimeout(
      () => document.addEventListener('mousedown', onPointerDown),
      0,
    );

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
      window.clearTimeout(timer);
      // Back where they came from, but only if focus is still inside the panel
      // -- a click that moved focus elsewhere should not be yanked back.
      if (panel?.contains(document.activeElement)) {
        (trigger ?? previouslyFocused)?.focus();
      }
    };
  }, [open, panelRef, triggerRef]);
}
