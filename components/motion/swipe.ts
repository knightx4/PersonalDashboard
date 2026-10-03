/**
 * Swipe, the touch half of the motion system (plan #1551): a card that moves
 * exactly with the finger and, when let go, springs away or back.
 *
 * `follow` writes the finger's position straight onto the element's style,
 * with no transition and no React render between the touch and the frame, so
 * the card never trails the finger. `release` then springs it from wherever
 * it is to where it is going: off the screen when the swipe counted, back to
 * rest when it did not. Both are for a deck, one item at a time, as Quick
 * read (app/news/quick/quick-controls.tsx) and Learn now
 * (app/learn/now/feed.tsx) work; the component keeps deciding what a drag
 * means, and these only move the card.
 *
 * The element's transform belongs to these two while it is in use, so the
 * component must not also set `transform` through React, nor give the
 * element a transform transition.
 */

import { EASE, MOTION_MS } from '@/lib/motion';
import { prefersReducedMotion } from './reduced';

/** How long a let-go card takes to spring away or back: one move. */
export const SWIPE_RELEASE_MS = MOTION_MS.move;

/** The release under way on each element, so a new touch can take over from it. */
const running = new WeakMap<Element, Animation>();

/**
 * Put `element` where the finger has it, at once. A release still springing
 * is stopped where it is, so a card caught mid-spring stays under the finger.
 */
export function follow(element: HTMLElement, transform: string): void {
  running.get(element)?.cancel();
  running.delete(element);
  element.style.transform = transform;
}

/**
 * Spring `element` from where it is now to `to`, a CSS transform, or back to
 * rest when `to` is empty. One move on the spring, so it passes its mark by a
 * little and comes back. The transform is left at `to` when it is done.
 *
 * Resolves when it has settled, and at once under reduced motion, outside a
 * browser, or without Web Animations, where the element is simply put at
 * `to`. Also resolves if a new touch takes the element over first.
 */
export function release(element: HTMLElement, to: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const before = running.get(element);
  // Mid-spring, the element is where the animation has it, not where its
  // style says it will end up.
  const from = before
    ? getComputedStyle(element).transform
    : element.style.transform || 'none';
  before?.cancel();
  running.delete(element);
  element.style.transform = to;

  const end = to || 'none';
  if (prefersReducedMotion() || typeof element.animate !== 'function' || from === end) {
    return Promise.resolve();
  }
  const animation = element.animate([{ transform: from }, { transform: end }], {
    duration: SWIPE_RELEASE_MS,
    easing: EASE.spring,
  });
  running.set(element, animation);
  const done = () => {
    if (running.get(element) === animation) running.delete(element);
  };
  return animation.finished.then(done, done);
}
