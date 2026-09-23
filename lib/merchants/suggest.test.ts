import { describe, expect, it } from 'vitest';
import { resolveMerchant, suggestMerchants } from '@/lib/merchants/suggest';

const merchants = [
  { id: 'a', name: 'Amazon' },
  { id: 'b', name: 'Best Buy' },
  { id: 'c', name: 'Bass Pro Shops' },
];

describe('the merchant field', () => {
  it('uses a merchant on file when the name matches, ignoring case', () => {
    expect(resolveMerchant(merchants, '  best buy ')).toEqual({ merchantId: 'b', customName: null });
  });

  it('saves anything else as a new merchant', () => {
    expect(resolveMerchant(merchants, 'Etsy ')).toEqual({ merchantId: null, customName: 'Etsy' });
  });

  it('leaves the merchant empty when nothing is typed', () => {
    expect(resolveMerchant(merchants, '  ')).toEqual({ merchantId: null, customName: null });
  });

  it('suggests names starting with the text before names containing it', () => {
    expect(suggestMerchants(merchants, 'b').map((m) => m.id)).toEqual(['b', 'c']);
    expect(suggestMerchants(merchants, 'pro').map((m) => m.id)).toEqual(['c']);
  });
});
