/**
 * When a drag on a Quick read card counts as a swipe to the next story
 * (#855). Pure, so the rules can be tested without a browser; QuickSwipe in
 * app/news/quick/quick-controls.tsx feeds it the touch positions.
 */

/** How far a card has to be dragged, as a share of its width, to count. */
export const SWIPE_SHARE = 1 / 3;

/** Movement under this many pixels does not yet say which way a drag is going. */
export const SWIPE_SLOP = 10;

/**
 * Which way a drag is going, read once it has moved past the slop: `'swipe'`
 * when it is mostly sideways and to the left, `'page'` for anything else,
 * which the page keeps (a scroll, or a drag to the right), and null while it
 * is still too small to tell.
 */
export function swipeAxis(dx: number, dy: number): 'swipe' | 'page' | null {
  if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return null;
  return dx < 0 && Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'page';
}

/** Whether a leftward drag of `dx` pixels on a card `width` wide is far enough. */
export function swipeFarEnough(dx: number, width: number): boolean {
  return width > 0 && -dx >= width * SWIPE_SHARE;
}
