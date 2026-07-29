import { describe, expect, it } from 'vitest';
import { isExcludedSender } from '@/lib/inbox/merchant-exclusion-match';

describe('isExcludedSender', () => {
  const exclusions = [
    { merchant_id: 'm-uber', match_domain: 'ubereats.com' },
    { merchant_id: null, match_domain: 'toasttab.com' },
  ];

  it('matches by merchant id', () => {
    expect(
      isExcludedSender(exclusions, {
        merchantId: 'm-uber',
        fromAddress: 'noreply@other.com',
      }),
    ).toBe(true);
  });

  it('matches by sender domain including subdomains', () => {
    expect(
      isExcludedSender(exclusions, {
        merchantId: null,
        fromAddress: 'orders@mail.toasttab.com',
      }),
    ).toBe(true);
    expect(
      isExcludedSender(exclusions, {
        merchantId: null,
        fromAddress: 'hello@nike.com',
      }),
    ).toBe(false);
  });
});
