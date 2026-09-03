import { describe, expect, it } from 'vitest';
import { planGroupApplication } from './apply-plan';

const THREE = ['a', 'b', 'c'];

describe('planGroupApplication', () => {
  it('takes the units in the order it was given, so the choice is repeatable', () => {
    const plan = planGroupApplication({
      ownedIds: THREE,
      sellQty: 2,
      giveawayQty: 0,
      response: { keepQty: 1, sellQty: 2, giveawayQty: 0 },
    });
    expect(plan.sellIds).toEqual(['a', 'b']);
    expect(plan.giveIds).toEqual([]);
  });

  it('never gives away a unit it already sold', () => {
    const plan = planGroupApplication({
      ownedIds: THREE,
      sellQty: 1,
      giveawayQty: 2,
      response: { keepQty: 0, sellQty: 1, giveawayQty: 2 },
    });
    expect(plan.sellIds).toEqual(['a']);
    expect(plan.giveIds).toEqual(['b', 'c']);
  });

  it('reports a shortfall rather than pretending it acted', () => {
    // Two of the three were sold from the inventory page in the meantime.
    const plan = planGroupApplication({
      ownedIds: ['a'],
      sellQty: 3,
      giveawayQty: 0,
      response: { keepQty: 0, sellQty: 3, giveawayQty: 0 },
    });
    expect(plan.sellIds).toEqual(['a']);
    expect(plan.shortfall).toBe(2);
  });

  it('clears an answer once there is nothing left of it', () => {
    const plan = planGroupApplication({
      ownedIds: THREE,
      sellQty: 3,
      giveawayQty: 0,
      response: { keepQty: 0, sellQty: 3, giveawayQty: 0 },
    });
    expect(plan.nextResponse).toBeNull();
  });

  it('keeps the part of the answer that was not acted on', () => {
    // She said keep 1, sell 2. Selling two leaves the keep standing, because
    // the box she wanted kept is still on the shelf and still spoken for.
    const plan = planGroupApplication({
      ownedIds: THREE,
      sellQty: 2,
      giveawayQty: 0,
      response: { keepQty: 1, sellQty: 2, giveawayQty: 0 },
    });
    expect(plan.nextResponse).toEqual({ keepQty: 1, sellQty: 0, giveawayQty: 0 });
  });

  it('leaves the unmet part of a request standing after a shortfall', () => {
    const plan = planGroupApplication({
      ownedIds: ['a'],
      sellQty: 3,
      giveawayQty: 0,
      response: { keepQty: 0, sellQty: 3, giveawayQty: 0 },
    });
    expect(plan.nextResponse).toEqual({ keepQty: 0, sellQty: 2, giveawayQty: 0 });
  });

  it('does nothing at all for a keep-only answer', () => {
    const plan = planGroupApplication({
      ownedIds: THREE,
      sellQty: 0,
      giveawayQty: 0,
      response: { keepQty: 3, sellQty: 0, giveawayQty: 0 },
    });
    expect(plan.sellIds).toEqual([]);
    expect(plan.giveIds).toEqual([]);
    expect(plan.shortfall).toBe(0);
    // The answer survives: keeping is a decision, it just is not an action.
    expect(plan.nextResponse).toEqual({ keepQty: 3, sellQty: 0, giveawayQty: 0 });
  });
});
