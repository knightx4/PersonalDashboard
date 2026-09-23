import { describe, expect, it } from 'vitest';
import { isExcludedMessage, isExcludedSender } from '@/lib/inbox/merchant-exclusion-match';

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

describe('isExcludedSender with Reply-To', () => {
  it('matches a muted shop that sends from a platform domain', () => {
    expect(
      isExcludedSender([{ merchant_id: null, match_domain: 'goodsofdesire.com' }], {
        merchantId: null,
        fromAddress: 'store@shopifyemail.com',
        replyToAddress: 'hello@goodsofdesire.com',
      }),
    ).toBe(true);
  });
});

describe('isExcludedMessage', () => {
  const muted = [{ merchant_id: null, match_domain: 'toasttab.com' }];
  const from = 'orders@mail.toasttab.com';

  it.each(['order_confirmation', 'shipping', 'delivery', 'return', 'cancellation'] as const)(
    'skips a muted %s email',
    (classification) => {
      expect(
        isExcludedMessage(muted, { classification, merchantId: null, fromAddress: from }),
      ).toBe(true);
    },
  );

  it('leaves mail that is not an order alone', () => {
    expect(
      isExcludedMessage(muted, {
        classification: 'not_relevant',
        merchantId: null,
        fromAddress: from,
      }),
    ).toBe(false);
  });

  it('does not skip a lifecycle email from a sender nobody muted', () => {
    expect(
      isExcludedMessage(muted, {
        classification: 'shipping',
        merchantId: null,
        fromAddress: 'ship@nike.com',
      }),
    ).toBe(false);
  });
});
