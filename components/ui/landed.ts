/**
 * The end of a capture's flight: the place an item landed pulses once and is
 * named beside it, "Todo · Today".
 *
 * Capture plays the puff at its input, flies a chip here (fly-chip.ts), then
 * calls `markLanded`. The place is the workspace's own row in the shell's
 * column or the phone's dock when that row is on screen, and the workspace
 * switcher when it is not (`landingTarget`). The shell marks both with data
 * attributes, so nothing here knows how the shell is laid out.
 *
 * The name is a fixed, pointer-less element on <body> at z-toast, above the
 * capture panel's scrim, and is gone after LANDED_NAME_MS. It is drawn under
 * reduced motion too: the pulse is what reduced motion takes away, and the
 * name is how the person learns where the item went.
 */

import { MOTION_MS } from '@/lib/motion';

/** The `landed-pulse` utility's duration in app/globals.css: one move. */
export const LANDED_PULSE_MS = MOTION_MS.move;

/** How long the name stays beside the place. Long enough to read three words. */
export const LANDED_NAME_MS = 2400;

/** The attribute on a shell nav row, holding its href. */
export const CAPTURE_NAV_ATTR = 'data-capture-nav';
/** The attribute on every workspace switcher trigger. */
export const CAPTURE_SWITCHER_ATTR = 'data-capture-switcher';

const GAP_PX = 8;
const EDGE_PX = 8;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function onScreen(rect: Box, viewport: { width: number; height: number }): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < viewport.width &&
    rect.top < viewport.height
  );
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function firstOnScreen(selector: string): Element | null {
  const view = viewport();
  for (const element of Array.from(document.querySelectorAll(selector))) {
    if (onScreen(element.getBoundingClientRect(), view)) return element;
  }
  return null;
}

/**
 * Where an item filed into the workspace whose home is `href` lands: that
 * workspace's nav row when one is on screen, otherwise the switcher that is,
 * otherwise nothing.
 */
export function landingTarget(href: string): Element | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  return (
    firstOnScreen(`[${CAPTURE_NAV_ATTR}="${CSS.escape(href)}"]`) ??
    firstOnScreen(`[${CAPTURE_SWITCHER_ATTR}]`)
  );
}

/**
 * Where the name goes, as the top left of a label of `size`: to the right of
 * the place when there is room (the desktop column), otherwise above it,
 * centred and kept on screen (the phone's dock), or below it when above is
 * off the top (the phone's top bar).
 */
export function namePosition(
  target: Box,
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const middle = target.top + target.height / 2 - size.height / 2;
  if (target.right + GAP_PX + size.width <= view.width - EDGE_PX) {
    return { left: Math.round(target.right + GAP_PX), top: Math.round(middle) };
  }
  const centred = target.left + target.width / 2 - size.width / 2;
  const left = Math.max(EDGE_PX, Math.min(centred, view.width - EDGE_PX - size.width));
  const above = target.top - GAP_PX - size.height;
  const top = above >= EDGE_PX ? above : target.bottom + GAP_PX;
  return { left: Math.round(left), top: Math.round(top) };
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const NAME_CLASS =
  'toast-in pointer-events-none fixed z-toast max-w-xs truncate rounded-full border border-border bg-raised px-2.5 py-1 text-small font-medium text-ink shadow-lg';

/** The name on screen now, so a second filing replaces it rather than stacking. */
let shown: { element: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Pulse `target` once and name it. The pulse is skipped under reduced motion;
 * the name never is. Does nothing outside a browser or for an empty name.
 */
export function markLanded(target: Element, name: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!name.trim()) return;

  if (!reducedMotion() && target instanceof HTMLElement) {
    // Off and on again, with a read between, so a second filing restarts it.
    target.classList.remove('landed-pulse');
    void target.offsetWidth;
    target.classList.add('landed-pulse');
    setTimeout(() => target.classList.remove('landed-pulse'), LANDED_PULSE_MS + 40);
  }

  if (shown) {
    clearTimeout(shown.timer);
    shown.element.remove();
    shown = null;
  }

  const label = document.createElement('span');
  label.setAttribute('role', 'status');
  label.className = NAME_CLASS;
  label.textContent = name;
  label.style.left = '0px';
  label.style.top = '0px';
  label.style.visibility = 'hidden';
  document.body.appendChild(label);

  const place = namePosition(
    target.getBoundingClientRect(),
    { width: label.offsetWidth, height: label.offsetHeight },
    viewport(),
  );
  label.style.left = `${place.left}px`;
  label.style.top = `${place.top}px`;
  label.style.visibility = '';

  const timer = setTimeout(() => {
    label.remove();
    if (shown?.element === label) shown = null;
  }, LANDED_NAME_MS);
  shown = { element: label, timer };
}
