/**
 * The board's moments, played (plans #1560, #1596). lib/jobs/board-moment.ts
 * says which one a move is; this plays it on the cards, on the shared motion
 * pieces in components/motion.
 *
 * - A role moving forward: the card glides from its old place to its new one
 *   while every other card and lane on the board glides to where the move
 *   puts it (`glideBoard`), so nothing jumps; then the column's name is laid
 *   across the card's own foot, where it covers no other card.
 * - An offer: the same glide, then the name reads "Offer · <company>" and one
 *   accent ring leaves the card. The one larger moment in Jobs.
 * - A rejection: the card fades where it is, with no movement, and the lane
 *   then closes up over the space it left. The sentence saying how many
 *   applications are still open is the board's, so it is there under reduced
 *   motion too.
 *
 * Under reduced motion the glide, the ring and the fade are skipped and the
 * names are kept: settle draws its name whatever the setting, and that name is
 * what tells the person where the role went.
 */

import { EASE, FLIGHT_MS, MOTION_MS } from '@/lib/motion';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { settle } from '@/components/motion/settle';

/** The attribute on each card, holding its application id. */
export const CARD_ATTR = 'data-application-id';

/** The attribute on each lane, holding the status a drop into it writes. */
export const LANE_ATTR = 'data-lane';

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

type Rect = { left: number; top: number; width: number; height: number };

/** Where each lane and card on screen stood, by `lane:<status>` and `card:<id>`. */
export type BoardLayout = Map<string, Rect>;

function onScreen(root: ParentNode, attr: string, prefix: string): [string, HTMLElement][] {
  const found: [string, HTMLElement][] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`))) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) found.push([`${prefix}${element.getAttribute(attr)}`, element]);
  }
  return found;
}

/** Where every lane and card on the board stands now, to glide from after a change. */
export function readLayout(root: ParentNode | null): BoardLayout {
  const layout: BoardLayout = new Map();
  if (!root) return layout;
  for (const [key, element] of [...onScreen(root, LANE_ATTR, 'lane:'), ...onScreen(root, CARD_ATTR, 'card:')]) {
    const { left, top, width, height } = element.getBoundingClientRect();
    layout.set(key, { left, top, width, height });
  }
  return layout;
}

/**
 * The offsets that carry everything on the board from `before` to where it is
 * now. A lane grows or shrinks between its two heights, and is not moved: the
 * lanes above it changing height carry it, a little each frame. A card moves
 * by its own offset less its lane's, since the lane is carried that far
 * already. Pure, so the arithmetic is tested.
 */
export function glideOffsets(
  before: BoardLayout,
  after: BoardLayout,
  laneOf: (cardKey: string) => string | null,
): Map<string, { dx: number; dy: number; fromHeight?: number; toHeight?: number }> {
  const offsets = new Map<string, { dx: number; dy: number; fromHeight?: number; toHeight?: number }>();
  const shift = (key: string) => {
    const from = before.get(key);
    const to = after.get(key);
    return from && to ? { dx: from.left - to.left, dy: from.top - to.top } : { dx: 0, dy: 0 };
  };
  for (const [key, to] of after) {
    const from = before.get(key);
    if (!from) continue;
    if (key.startsWith('lane:')) {
      offsets.set(key, { dx: 0, dy: 0, fromHeight: from.height, toHeight: to.height });
      continue;
    }
    const lane = laneOf(key);
    const carried = lane ? shift(lane) : { dx: 0, dy: 0 };
    offsets.set(key, { dx: from.left - to.left - carried.dx, dy: from.top - to.top - carried.dy });
  }
  return offsets;
}

/**
 * Glide every lane and card from `before` to where it now stands, `raised`
 * (the card that moved) drawn over the rest while it crosses. Resolves when
 * all have arrived, and at once under reduced motion, where the board is
 * simply in its new state.
 */
export function glideBoard(root: HTMLElement | null, before: BoardLayout, raised?: HTMLElement | null): Promise<void> {
  if (!root || prefersReducedMotion() || typeof root.animate !== 'function') return Promise.resolve();
  const after = readLayout(root);
  const elements = new Map(
    [...onScreen(root, LANE_ATTR, 'lane:'), ...onScreen(root, CARD_ATTR, 'card:')].map(([key, el]) => [key, el]),
  );
  const laneOf = (key: string) => {
    const lane = elements.get(key)?.closest(`[${LANE_ATTR}]`);
    return lane ? `lane:${lane.getAttribute(LANE_ATTR)}` : null;
  };
  const timing = { duration: FLIGHT_MS, easing: EASE.outSoft };
  const moves: Promise<unknown>[] = [];
  for (const [key, offset] of glideOffsets(before, after, laneOf)) {
    const element = elements.get(key);
    if (!element) continue;
    const resized = offset.fromHeight !== undefined && Math.abs(offset.fromHeight - (offset.toHeight ?? 0)) >= 1;
    if (Math.abs(offset.dx) < 1 && Math.abs(offset.dy) < 1 && !resized) continue;
    const start: Keyframe = { transform: `translate(${Math.round(offset.dx)}px, ${Math.round(offset.dy)}px)` };
    const end: Keyframe = { transform: 'none' };
    if (resized) {
      start.height = `${offset.fromHeight}px`;
      end.height = `${offset.toHeight}px`;
    }
    moves.push(element.animate([start, end], timing).finished.catch(() => undefined));
  }
  if (raised) {
    raised.style.zIndex = '10';
    void Promise.all(moves).then(() => {
      raised.style.zIndex = '';
    });
  }
  return Promise.all(moves).then(() => undefined);
}

/** A role moving forward: the board glides into its new state, then the card is named. */
export async function playForward(root: HTMLElement | null, card: HTMLElement, before: BoardLayout, column: string) {
  await glideBoard(root, before, card);
  settle(card, column, { at: 'edge', pulse: false });
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

/** An offer: the glide, the card named as the offer, and the ring. */
export async function playOffer(root: HTMLElement | null, card: HTMLElement, before: BoardLayout, company: string) {
  await glideBoard(root, before, card);
  settle(card, company.trim() ? `Offer · ${company.trim()}` : 'Offer', { at: 'edge', pulse: false });
  await ringOut(card);
}

/** The keyframes of a rejection: the card goes clear where it stands. */
export const FADE_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

/**
 * A rejection: the card fades in place over a moment, with nothing moving.
 * Resolves when it has gone, and at once under reduced motion, where the card
 * simply leaves when the write is drawn. The board then closes the lane up
 * with `glideBoard`.
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
