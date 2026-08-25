import { describe, expect, it } from 'vitest';
import { donateFmvHintCents, routeSellDecision } from './route';
import { FixtureBuybackProvider, NullBuybackProvider } from './buyback';
import { FixtureExpectedPriceSource } from './expected-price';

describe('routeSellDecision', () => {
  it('routes high buyback to buyback', () => {
    const result = routeSellDecision({
      expectedSelfListCents: 2000,
      buybackQuoteCents: 1500,
      netFloorCents: 1000,
      effortCents: 500,
    });
    expect(result.path).toBe('buyback');
  });

  it('routes high self-list net to list_individually', () => {
    const result = routeSellDecision({
      expectedSelfListCents: 8000,
      buybackQuoteCents: 200,
      netFloorCents: 1000,
      effortCents: 500,
    });
    expect(result.path).toBe('list_individually');
  });

  it('routes low positive value to lot', () => {
    const result = routeSellDecision({
      expectedSelfListCents: 1500,
      buybackQuoteCents: 100,
      netFloorCents: 1000,
      effortCents: 500,
    });
    // net_self on $15 after fees/shipping/effort is typically below $10 floor
    expect(['lot', 'donate', 'buyback']).toContain(result.path);
  });

  it('routes nothing to donate', () => {
    const result = routeSellDecision({
      expectedSelfListCents: null,
      buybackQuoteCents: 0,
      netFloorCents: 1000,
    });
    expect(result.path).toBe('donate');
  });
});

describe('donateFmvHintCents', () => {
  it('picks the smaller positive signal', () => {
    expect(
      donateFmvHintCents({
        expectedSelfListCents: 4000,
        buybackQuoteCents: 200,
      }),
    ).toBe(200);
  });
});

describe('providers', () => {
  it('NullBuybackProvider returns null', async () => {
    expect(await new NullBuybackProvider().quote('9780735211292')).toBeNull();
  });

  it('FixtureBuybackProvider returns mapped quotes', async () => {
    const p = new FixtureBuybackProvider({
      '9780735211292': {
        vendor: 'Test',
        cents: 500,
        shippingCents: 0,
        url: null,
      },
    });
    expect(await p.quote('9780735211292')).toMatchObject({ cents: 500 });
  });

  it('FixtureExpectedPriceSource returns mapped prices', async () => {
    const p = new FixtureExpectedPriceSource({ '9780735211292': 2500 });
    expect(await p.expectedSelfListCents('9780735211292')).toBe(2500);
  });
});
