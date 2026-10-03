/**
 * The board's moments, played (plan #1560). lib/jobs/board-moment.ts says
 * which one a move is; this plays it on the card, on the shared motion pieces
 * in components/motion.
 *
 * - A role moving forward: the card springs from its old column to its new
 *   one (travelElement) and settles there with the column's name beside it.
 * - An offer: the same travel, then one accent ring leaves the card and the
 *   name reads "Offer · <company>". The one larger moment in Jobs.
 * - A rejection: the card fades where it is, with no movement, before it
 *   files into Closed. The line saying how many applications are still open
 *   is the board's, so it is there under reduced motion too.
 *
 * Under reduced motion the travel, the ring and the fade are skipped and the
 * names are kept: settle draws its name whatever the setting, and that name is
 * what tells the person where the role went.
 */

import { EASE, MOTION_MS } from '@/lib/motion';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { settle } from '@/components/motion/settle';
import { travelElement } from '@/components/motion/travel';

/** The attribute on each card, holding its application id. */
export const CARD_ATTR = 'data-application-id';

/**
 * The card for `applicationId` that is on screen inside `root`. The board
 * draws each card twice, the stacked phone layout and the wider one, and
 * only one of them has a size.
 */
export function visibleCard(root: ParentNode | null, applicationId: string): HTMLElement | null {
  if (!root) return null;
  const selector = `[${CARD_ATTR}="${CSS.escape(applicationId)}"]`;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

/** A role moving forward: travel from `from` into the new column, then name it. */
export async function playForward(card: HTMLElement, from: DOMRectReadOnly | null, column: string) {
  if (from) await travelElement(card, from);
  settle(card, column);
}

/** The keyframes of the offer's ring: out from the card's edge, and gone. */
export const OFFER_RING_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1)', opacity: 0.9 },
  { transform: 'scale(1.12, 1.4)', opacity: 0 },
];

const RING_CLASS =
  /* ui-ok: a floating outline over the card for one moment, not a grouping box */
  'pointer-events-none fixed z-toast rounded-card border-2 border-accent';

/** One ring in the accent, leaving the card's outline and fading as it grows. */
function ringOut(card: HTMLElement): Promise<void> {
  if (prefersReducedMotion() || typeof document === 'undefined') return Promise.resolve();
  const rect = card.getBoundingClientRect();
  if (!rect.width || !rect.height) return Promise.resolve();
  const ring = document.createElement('span');
  ring.setAttribute('aria-hidden', 'true');
  ring.className = RING_CLASS;
  ring.style.left = `${rect.left}px`;
  ring.style.top = `${rect.top}px`;
  ring.style.width = `${rect.width}px`;
  ring.style.height = `${rect.height}px`;
  document.body.appendChild(ring);
  if (typeof ring.animate !== 'function') {
    ring.remove();
    return Promise.resolve();
  }
  const animation = ring.animate(OFFER_RING_KEYFRAMES, {
    duration: MOTION_MS.moment,
    easing: EASE.outSoft,
    fill: 'forwards',
  });
  return animation.finished.then(
    () => ring.remove(),
    () => ring.remove(),
  );
}

/** An offer: the travel, the ring, and the card named as the offer. */
export async function playOffer(card: HTMLElement, from: DOMRectReadOnly | null, company: string) {
  if (from) await travelElement(card, from);
  settle(card, company.trim() ? `Offer · ${company.trim()}` : 'Offer');
  await ringOut(card);
}

/** The keyframes of a rejection: the card goes clear where it stands. */
export const FADE_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

/**
 * A rejection: the card fades in place over a moment, with nothing moving.
 * Resolves when it has gone, and at once under reduced motion, where the card
 * simply leaves when the write is drawn.
 */
export function fadeInPlace(card: HTMLElement | null): Promise<void> {
  if (!card || prefersReducedMotion() || typeof card.animate !== 'function') {
    return Promise.resolve();
  }
  const animation = card.animate(FADE_KEYFRAMES, {
    duration: MOTION_MS.moment,
    easing: EASE.outSoft,
    fill: 'forwards',
  });
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}
