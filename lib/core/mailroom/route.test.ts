import { beforeEach, describe, expect, it } from 'vitest';
import { handedOver, HANDOVER_MIN_AGREED } from './handover';
import type { AgreementRow } from './report';
import { clearHandoverCache, jevRouting, routeClaim } from './route';

function row(linker: string, agree: number, rulesOnly: number): AgreementRow {
  return {
    linker,
    pile: 'bill',
    rules: agree + rulesOnly,
    jev: agree,
    jev_sure: agree,
    agree,
    rules_only: rulesOnly,
    jev_only: 0,
    jev_only_sure: 0,
    agreement: null,
  };
}

/** A core client whose tables and functions answer from memory. */
function fakeCore(opts: {
  jevEnabled: boolean;
  agreement: AgreementRow[];
  piles: { id: string; pile: string; confidence: number }[];
}) {
  const calls = { agreement: 0 };
  const core = {
    from(table: string) {
      if (table === 'account_settings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { jev_enabled: opts.jevEnabled }, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => ({
            gte: async (_c: string, floor: number) => ({
              data: opts.piles.filter((p) => ids.includes(p.id) && p.confidence >= floor),
              error: null,
            }),
          }),
        }),
      };
    },
    async rpc(name: string) {
      if (name === 'mail_pile_agreement') calls.agreement += 1;
      return { data: opts.agreement, error: null };
    },
  };
  return { core: core as never, calls };
}

describe('the handover gate', () => {
  it('stays shut with too little evidence or too many misses', () => {
    expect(handedOver(undefined).open).toBe(false);
    expect(handedOver(row('recurring', 0, 0))).toMatchObject({ open: false, missRate: null });
    expect(handedOver(row('recurring', HANDOVER_MIN_AGREED - 1, 0)).open).toBe(false);
    expect(handedOver(row('recurring', 40, 3)).open).toBe(false);
  });

  it('opens once Jev catches what the rules caught', () => {
    expect(handedOver(row('recurring', HANDOVER_MIN_AGREED, 0)).open).toBe(true);
    expect(handedOver(row('recurring', 60, 3))).toMatchObject({ open: true, agreed: 60, missed: 3 });
  });
});

describe('routing a claim', () => {
  it('lets the rules decide without a sure pile', () => {
    expect(routeClaim({ rules: 'bill', pile: undefined, own: 'bill', fromJev: 'x' })).toEqual({
      claim: 'bill',
      by: 'rules',
    });
    expect(routeClaim({ rules: null, pile: undefined, own: 'bill', fromJev: 'x' }).claim).toBeNull();
  });

  it('claims on Jev\'s pile alone and turns down another pile', () => {
    expect(routeClaim({ rules: null, pile: 'bill', own: 'bill', fromJev: 'x' })).toEqual({ claim: 'x', by: 'jev' });
    expect(routeClaim({ rules: 'price_change', pile: 'bill', own: 'bill', fromJev: 'x' }).claim).toBe('price_change');
    expect(routeClaim({ rules: 'bill', pile: 'order', own: 'bill', fromJev: 'x' })).toEqual({ claim: null, by: 'jev' });
  });
});

describe('reading the sure piles', () => {
  beforeEach(() => clearHandoverCache());

  const piles = [
    { id: 'a', pile: 'bill', confidence: 0.92 },
    { id: 'b', pile: 'order', confidence: 0.85 },
    { id: 'c', pile: 'bill', confidence: 0.4 },
  ];

  it('returns nothing while the gate is shut', async () => {
    const { core } = fakeCore({ jevEnabled: true, agreement: [row('recurring', 5, 0)], piles });
    expect(await jevRouting(core, { userId: 'u', linker: 'recurring', ids: ['a'] })).toBeNull();
  });

  it('returns nothing for an account that has not agreed to Jev', async () => {
    const { core } = fakeCore({ jevEnabled: false, agreement: [row('recurring', 50, 0)], piles });
    expect(await jevRouting(core, { userId: 'u', linker: 'recurring', ids: ['a'] })).toBeNull();
  });

  it('returns the sure piles once handed over, and reads the gate once', async () => {
    const { core, calls } = fakeCore({ jevEnabled: true, agreement: [row('recurring', 50, 1)], piles });
    const routing = await jevRouting(core, { userId: 'u', linker: 'recurring', ids: ['a', 'b', 'c'] });
    expect([...routing!.piles]).toEqual([
      ['a', 'bill'],
      ['b', 'order'],
    ]);
    await jevRouting(core, { userId: 'u', linker: 'recurring', ids: ['a'] });
    expect(calls.agreement).toBe(1);
  });
});
