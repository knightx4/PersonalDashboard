/**
 * Travel, one of the three shared motion pieces (plan #1550): a chip carrying
 * an item's first words flies from one place on screen to another, then
 * removes itself.
 *
 * Capture uses it to show where an item went: the first words of what was
 * typed leave the input and land on the list that now holds them. Any screen
 * showing something going to its place uses it the same way, usually through
 * sendToPlace in ./place.ts, which puts the leaving and the settling either
 * side of it. It is
 * chrome, so it never holds anything up. The promise resolves when the chip
 * has landed and gone, and at once when there is nothing to animate.
 *
 * The chip is a fixed element appended to <body> with pointer events off, and
 * only its transform and opacity are animated, so nothing on the page moves
 * or reflows while it crosses.
 *
 * Under prefers-reduced-motion it does nothing. The CSS block in
 * app/globals.css cannot reach a Web Animations call, so the check is here.
 */

import { EASE, FLIGHT_MS } from '@/lib/motion';
import { prefersReducedMotion } from './reduced';

/**
 * Long enough to follow across a 1280px screen; still well under a second.
 * A move and a quick together (FLIGHT_MS in lib/motion.ts).
 */
export const TRAVEL_MS = FLIGHT_MS;

/** How many words of the item the chip carries, and the most characters. */
const LABEL_WORDS = 4;
const LABEL_CHARS = 32;

/** Either an element, read at the moment of the call, or a rect taken earlier. */
export type TravelPoint = Element | DOMRectReadOnly;

export type TravelInput = {
  from: TravelPoint;
  to: TravelPoint;
  /** The item's text. The chip shows its first few words. */
  label: string;
};

/** The first few words of `text`, cut with an ellipsis when there was more. */
export function chipLabel(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let label = words.slice(0, LABEL_WORDS).join(' ');
  let cut = words.length > LABEL_WORDS;
  if (label.length > LABEL_CHARS) {
    label = label.slice(0, LABEL_CHARS).trimEnd();
    cut = true;
  }
  return cut ? `${label}…` : label;
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * The keyframes that carry a chip of `size`, placed at the viewport's top
 * left, from the centre of `from` to the centre of `to`. It fades in over the
 * first fifth, travels, and shrinks and fades as it lands.
 */
export function flightKeyframes(
  from: Box,
  to: Box,
  size: { width: number; height: number },
): Keyframe[] {
  const at = (box: Box) => ({
    x: box.left + box.width / 2 - size.width / 2,
    y: box.top + box.height / 2 - size.height / 2,
  });
  const start = at(from);
  const end = at(to);
  const move = (p: { x: number; y: number }, scale: number) =>
    `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) scale(${scale})`;
  return [
    { transform: move(start, 0.9), opacity: 0, offset: 0 },
    { transform: move(start, 1), opacity: 1, offset: 0.2 },
    { transform: move(end, 0.6), opacity: 0, offset: 1 },
  ];
}

function boxOf(point: TravelPoint): Box {
  const rect = 'getBoundingClientRect' in point ? point.getBoundingClientRect() : point;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const CHIP_CLASS =
  'pointer-events-none fixed left-0 top-0 z-toast max-w-xs truncate rounded-full border border-border bg-raised px-2.5 py-1 font-mono text-micro text-ink shadow-lg';

/**
 * Fly a chip carrying the first words of `label` from `from` to `to`.
 * Resolves when it has landed and been removed. Resolves at once, drawing
 * nothing, under reduced motion, outside a browser, when the browser has no
 * Web Animations, or when either end has no size (hidden or unmounted).
 */
export function travel({ from, to, label }: TravelInput): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();

  const a = boxOf(from);
  const b = boxOf(to);
  if (!a.width || !a.height || !b.width || !b.height) return Promise.resolve();

  const text = chipLabel(label);
  if (!text) return Promise.resolve();

  const chip = document.createElement('span');
  chip.setAttribute('aria-hidden', 'true');
  chip.className = CHIP_CLASS;
  chip.textContent = text;
  chip.style.opacity = '0';
  chip.style.willChange = 'transform, opacity';
  document.body.appendChild(chip);

  if (typeof chip.animate !== 'function') {
    chip.remove();
    return Promise.resolve();
  }

  const size = { width: chip.offsetWidth, height: chip.offsetHeight };
  const animation = chip.animate(flightKeyframes(a, b, size), {
    duration: TRAVEL_MS,
    easing: EASE.outSoft,
    fill: 'forwards',
  });

  return animation.finished.then(
    () => chip.remove(),
    () => chip.remove(),
  );
}
