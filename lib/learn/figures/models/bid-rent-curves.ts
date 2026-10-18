/**
 * The arithmetic of the bid-rent model (plan #2321.8), apart from its drawing
 * so the plot and the captions read the same numbers.
 *
 * A city with one centre, where everyone works. Three uses bid for land at
 * each distance from it, in pounds a square metre a year, and the land goes
 * to whichever bids most:
 *
 *   offices   500 - 100x          (firms pay most to be central)
 *   homes     5 × income - T(x)   (households pay less the longer the commute)
 *   farms     20                  (farmland pays the same anywhere)
 *
 * T(x) is the cost of commuting x km: `commute` pounds a km by road, half
 * that on a rail line running `rail` km out from the centre, so a home past
 * the line's end rides it first and drives the rest. Offices give way to
 * homes where their lines cross, and homes give way to farms at the city's
 * edge. Over the sliders' ranges the offices end between about 2.5 and 4 km
 * and the edge stays inside the plot's 50 km.
 */

export const DISTANCE_MAX = 50;
export const RENT_MAX = 500;
export const FARM_RENT = 20;
const OFFICE_CENTRE = 500;
const OFFICE_SLOPE = 100;
const BID_PER_INCOME = 5;

export type BidRentValues = { commute: number; income: number; rail: number };

/** What commuting x km costs, a square metre of home a year. */
export function commuteCost(x: number, { commute, rail }: BidRentValues): number {
  return x <= rail ? (commute / 2) * x : commute * x - (commute * rail) / 2;
}

export function officeBid(x: number): number {
  return OFFICE_CENTRE - OFFICE_SLOPE * x;
}

export function homeBid(x: number, values: BidRentValues): number {
  return BID_PER_INCOME * values.income - commuteCost(x, values);
}

/** Where offices give way to homes. */
export function officesEnd(values: BidRentValues): number {
  const top = BID_PER_INCOME * values.income;
  const onRail = (OFFICE_CENTRE - top) / (OFFICE_SLOPE - values.commute / 2);
  if (onRail <= values.rail) return onRail;
  return (
    (OFFICE_CENTRE - top - (values.commute * values.rail) / 2) / (OFFICE_SLOPE - values.commute)
  );
}

/** Where homes give way to farms: the city's edge. */
export function cityEdge(values: BidRentValues): number {
  const spare = BID_PER_INCOME * values.income - FARM_RENT;
  const onRail = (2 * spare) / values.commute;
  if (onRail <= values.rail) return onRail;
  return spare / values.commute + values.rail / 2;
}

/** The rent land fetches x km out: the highest bid for it. */
export function rentAt(x: number, values: BidRentValues): number {
  return Math.max(officeBid(x), homeBid(x, values), FARM_RENT);
}

type Point = { x: number; r: number };

/** Each use's line over the land it wins, from the centre out. */
export function envelope(values: BidRentValues): {
  offices: Point[];
  homes: Point[];
  farms: Point[];
} {
  const end = officesEnd(values);
  const edge = cityEdge(values);
  const kink = values.rail > end && values.rail < edge ? [values.rail] : [];
  return {
    offices: [0, end].map((x) => ({ x, r: officeBid(x) })),
    homes: [end, ...kink, edge].map((x) => ({ x, r: homeBid(x, values) })),
    farms: [edge, DISTANCE_MAX].map((x) => ({ x, r: FARM_RENT })),
  };
}

/** A distance as the page shows it: 18 km, or 3.3 km. */
export function km(x: number): string {
  const rounded = Math.round(x * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} km`;
}

/** A rent as the page shows it: £150. */
export function rent(r: number): string {
  return `£${Math.round(r)}`;
}
