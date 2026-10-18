import type { ExplorableModel, ModelValues } from './types';
import { SupplyDemandPlot } from './supply-demand-plot';
import { demandAt, equilibrium, pounds, supplyAt, units } from './supply-demand-curves';

/**
 * Supply and demand (plan #2321.7): shift either curve and read the new
 * price and quantity where they cross. The first explorable model, for any
 * lesson on how a market price forms or why it moves.
 */

const SHIFT = { min: -30, max: 30, step: 5, start: 0 } as const;

function shiftWords(value: number, from: number): string {
  const by = value - from;
  if (by === 0) return 'Where it started';
  return `${by > 0 ? 'Up' : 'Down'} ${Math.abs(by)} at every price`;
}

function shifts(values: ModelValues) {
  return { demand: values.demand ?? 0, supply: values.supply ?? 0 };
}

function moveWords(what: string, now: string, was: string, rises: boolean | null): string {
  if (rises === null) return `${what} stays at ${now}`;
  return `${what} ${rises ? 'rises' : 'falls'} from ${was} to ${now}`;
}

function direction(now: number, was: number): boolean | null {
  return Math.abs(now - was) < 1e-9 ? null : now > was;
}

export const supplyDemandModel: ExplorableModel = {
  id: 'supply_demand',
  field: 'Economics',
  label: 'Supply and demand',
  teaches:
    'a market’s demand and supply curves, either of which can be shifted; the price and quantity are read where they cross. For how a price forms, and why a change in buyers’ wants or in sellers’ costs moves it.',
  params: [
    { id: 'demand', label: 'Demand', ...SHIFT, say: shiftWords },
    { id: 'supply', label: 'Supply', ...SHIFT, say: shiftWords },
  ],
  describe(values, from) {
    const now = shifts(values);
    const was = shifts(from);
    const meet = equilibrium(now);
    const before = equilibrium(was);
    const byDemand = now.demand - was.demand;
    const bySupply = now.supply - was.supply;
    if (byDemand === 0 && bySupply === 0) {
      return `Buyers and sellers meet at ${pounds(meet.price)}, where ${units(meet.quantity)} are bought and sold. Move either curve to see where they meet next.`;
    }
    const causes = [
      byDemand !== 0 && `buyers want ${Math.abs(byDemand)} ${byDemand > 0 ? 'more' : 'fewer'} at every price`,
      bySupply !== 0 && `sellers offer ${Math.abs(bySupply)} ${bySupply > 0 ? 'more' : 'fewer'} at every price`,
    ].filter(Boolean);
    const cause = causes.join(' and ');
    const price = moveWords('the price', pounds(meet.price), pounds(before.price), direction(meet.price, before.price));
    const quantity = moveWords('the quantity bought and sold', units(meet.quantity), units(before.quantity), direction(meet.quantity, before.quantity));
    return `Now ${cause}, so ${price} and ${quantity}.`;
  },
  readouts(values, from) {
    const meet = equilibrium(shifts(values));
    const before = equilibrium(shifts(from));
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    return [
      { label: 'Price', value: pounds(meet.price), was: same(meet.price, before.price) ? null : pounds(before.price) },
      { label: 'Quantity', value: units(meet.quantity), was: same(meet.quantity, before.quantity) ? null : units(before.quantity) },
    ];
  },
  table(values) {
    const now = shifts(values);
    const prices = [0, 2, 4, 6, 8, 10, 12];
    return {
      head: ['Price', 'Buyers want', 'Sellers offer'],
      rows: prices.map((price) => [
        pounds(price),
        units(Math.max(0, demandAt(price, now.demand))),
        units(Math.max(0, supplyAt(price, now.supply))),
      ]),
    };
  },
  Plot: SupplyDemandPlot,
  example: {
    caption: 'A frost cuts the coffee harvest: move supply and watch the price and the cups sold.',
    start: { demand: 0, supply: 0 },
    moved: { demand: 0, supply: -20 },
  },
};
