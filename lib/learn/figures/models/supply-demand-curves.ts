/**
 * The arithmetic of the supply-and-demand model (plan #2321.7), apart from
 * its drawing so the plot and the captions read the same numbers.
 *
 * Two straight lines over a price from £0 to £12:
 *
 *   buyers want   Qd = 100 - 10P + demand
 *   sellers offer Qs = 10P - 20 + supply
 *
 * `demand` and `supply` are the sliders: how far each curve has moved, as a
 * quantity added at every price. They meet where Qd = Qs, at
 * P = (120 + demand - supply) / 20. With both sliders between -30 and 30 the
 * meeting point stays inside the plot, between £3 and £9.
 */

export const PRICE_MAX = 12;
export const QUANTITY_MAX = 140;

export type Shifts = { demand: number; supply: number };

export function demandAt(price: number, demand: number): number {
  return 100 - 10 * price + demand;
}

export function supplyAt(price: number, supply: number): number {
  return 10 * price - 20 + supply;
}

/** Where the two curves cross: the price the market settles at and the quantity bought and sold there. */
export function equilibrium({ demand, supply }: Shifts): { price: number; quantity: number } {
  const price = (120 + demand - supply) / 20;
  return { price, quantity: demandAt(price, demand) };
}

type Point = { q: number; p: number };

/** The demand curve's two ends inside the plot. */
export function demandLine(demand: number): [Point, Point] {
  const top = Math.min(PRICE_MAX, (100 + demand) / 10);
  return [
    { q: demandAt(0, demand), p: 0 },
    { q: demandAt(top, demand), p: top },
  ];
}

/** The supply curve's two ends inside the plot. */
export function supplyLine(supply: number): [Point, Point] {
  const bottom = Math.max(0, (20 - supply) / 10);
  return [
    { q: supplyAt(bottom, supply), p: bottom },
    { q: supplyAt(PRICE_MAX, supply), p: PRICE_MAX },
  ];
}

/** A price as the page shows it: £6.00. */
export function pounds(price: number): string {
  return `£${price.toFixed(2)}`;
}

/** A quantity as the page shows it: 45, or 42.5. */
export function units(quantity: number): string {
  const rounded = Math.round(quantity * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
