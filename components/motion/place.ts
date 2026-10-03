/**
 * Something going to its place, in one call (plan #1550): a puff where it
 * left, a chip carrying its first words across, and the place it landed
 * pulsing once with its name beside it. The three pieces are ./clear.tsx
 * (puffAt), ./travel.ts and ./settle.ts; this is the order capture plays them
 * in, so any screen that calls it looks the same as capture does.
 *
 * All of it is chrome: call it after the change has been saved, and nothing
 * waits on it. Under reduced motion the puff and the chip resolve at once
 * without drawing, so the name appears straight away and is the only thing
 * that does.
 */

import { puffAt } from './clear';
import { settle } from './settle';
import { travel, type TravelPoint } from './travel';

export type SendToPlaceInput = {
  /**
   * Where the item left. Take a rect before the screen changes when the
   * element is about to go: an element that has gone has no size, and the
   * puff and chip skip it silently. Without one, only the settling plays.
   */
  from?: TravelPoint;
  /** The place it landed. Without one, only the puff plays. */
  to: Element | null;
  /** The item's text. The chip carries its first few words. */
  label: string;
  /** The place's name, shown beside it: "Todo · Today". */
  name: string;
};

/**
 * Play the puff at `from`, fly the chip to `to`, then settle `to` with its
 * name. Resolves once the place has been named.
 */
export async function sendToPlace({ from, to, label, name }: SendToPlaceInput): Promise<void> {
  if (from) void puffAt(from);
  if (!to) return;
  if (from) await travel({ from, to, label });
  settle(to, name);
}
