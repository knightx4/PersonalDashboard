import { describe, expect, it } from 'vitest';
import { chooseExclusionDomain } from '@/lib/review/exclude-sender';

describe('chooseExclusionDomain', () => {
  it('prefers the Reply-To domain, which is the shop behind a platform sender', () => {
    expect(
      chooseExclusionDomain({
        fromAddress: 'Goods of Desire <store+123@shopifyemail.com>',
        replyToAddress: 'hello@goodsofdesire.com',
      }),
    ).toEqual({ ok: true, domain: 'goodsofdesire.com' });
  });

  it('uses From when there is no Reply-To', () => {
    expect(
      chooseExclusionDomain({ fromAddress: 'orders@mail.nike.com', replyToAddress: null }),
    ).toEqual({ ok: true, domain: 'mail.nike.com' });
  });

  it('falls back to From when Reply-To is a shared help desk', () => {
    expect(
      chooseExclusionDomain({
        fromAddress: 'orders@shop.example',
        replyToAddress: 'support@shop.zendesk.com',
      }),
    ).toEqual({ ok: true, domain: 'shop.example' });
  });

  it('refuses a platform domain with the reason', () => {
    const choice = chooseExclusionDomain({
      fromAddress: 'noreply@shopify.com',
      replyToAddress: null,
    });
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.reason).toMatch(/shopify\.com sends mail for many shops/);
  });

  it('refuses when every address is shared, such as a PayPal receipt', () => {
    const choice = chooseExclusionDomain({
      fromAddress: 'service@paypal.com',
      replyToAddress: 'someone@gmail.com',
    });
    expect(choice.ok).toBe(false);
  });

  it('refuses an email with no usable address', () => {
    expect(chooseExclusionDomain({ fromAddress: null, replyToAddress: 'not an address' }).ok).toBe(
      false,
    );
  });
});
