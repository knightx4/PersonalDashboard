/**
 * A small puff at a point: a few soft circles spread out from it and fade.
 *
 * Capture plays it at the input as an item leaves, just before a chip flies
 * to where the item went (components/ui/fly-chip.ts). It is chrome, so it
 * never holds anything up. The promise resolves once the puff has been
 * removed, and at once when nothing is drawn.
 *
 * The animation is CSS: `@keyframes puff` and the `puff` utility in
 * app/globals.css, which also hides it under prefers-reduced-motion. This
 * file places the circles in a fixed, pointer-less, aria-hidden element on
 * <body>, gives each its drift, and removes the element when the keyframes
 * are done. It also checks reduced motion itself, so nothing is appended at
 * all rather than appended and hidden.
 */

/** The `puff` utility's duration in app/globals.css. Change both together. */
export const PUFF_MS = 360;

/** How many circles, and how far each one drifts from the point. */
const PUFF_DOTS = 5;
const PUFF_RADIUS_PX = 18;

/** A viewport point, an element (its centre, read now), or a rect taken earlier. */
export type PuffPoint = { x: number; y: number } | Element | DOMRectReadOnly;

/**
 * Where each of `count` circles drifts to, spread evenly round the point,
 * starting straight up, rounded to whole pixels.
 */
export function puffOffsets(
  count = PUFF_DOTS,
  radius = PUFF_RADIUS_PX,
): { dx: number; dy: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return {
      dx: Math.round(Math.cos(angle) * radius),
      dy: Math.round(Math.sin(angle) * radius),
    };
  });
}

/**
 * The viewport point a puff starts from: the point itself, or the centre of
 * the element or rect. Null for an element or rect with no size, which is
 * hidden or unmounted.
 */
export function puffOrigin(point: PuffPoint): { x: number; y: number } | null {
  if ('getBoundingClientRect' in point || 'width' in point) {
    const rect = 'getBoundingClientRect' in point ? point.getBoundingClientRect() : point;
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: point.x, y: point.y };
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const PUFF_CLASS = 'pointer-events-none fixed z-toast h-0 w-0';

/**
 * Play a puff at `point`. Resolves once it has been removed. Resolves at
 * once, drawing nothing, under reduced motion, outside a browser, or when
 * the element or rect has no size.
 */
export function puffAt(point: PuffPoint): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (reducedMotion()) return Promise.resolve();

  const origin = puffOrigin(point);
  if (!origin) return Promise.resolve();

  const puff = document.createElement('span');
  puff.setAttribute('aria-hidden', 'true');
  puff.className = PUFF_CLASS;
  puff.style.left = `${Math.round(origin.x)}px`;
  puff.style.top = `${Math.round(origin.y)}px`;

  for (const { dx, dy } of puffOffsets()) {
    const dot = document.createElement('span');
    dot.className = 'puff';
    dot.style.setProperty('--puff-dx', `${dx}px`);
    dot.style.setProperty('--puff-dy', `${dy}px`);
    puff.appendChild(dot);
  }
  document.body.appendChild(puff);

  // A timer rather than animationend: it fires whether or not the keyframes
  // ran, so the element never outlives the puff.
  return new Promise((resolve) => {
    setTimeout(() => {
      puff.remove();
      resolve();
    }, PUFF_MS + 40);
  });
}
