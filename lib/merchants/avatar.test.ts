import { describe, expect, it } from 'vitest';
import {
  merchantFaviconUrl,
  merchantInitials,
  primaryMerchantDomain,
} from './avatar';

describe('primaryMerchantDomain', () => {
  it('prefers a clean retail domain over mail subdomains', () => {
    expect(
      primaryMerchantDomain(['order-update.amazon.com', 'amazon.com']),
    ).toBe('amazon.com');
  });

  it('strips www', () => {
    expect(primaryMerchantDomain(['www.target.com'])).toBe('target.com');
  });
});

describe('merchantFaviconUrl', () => {
  it('builds a google favicon URL', () => {
    expect(merchantFaviconUrl('amazon.com')).toContain('domain=amazon.com');
  });
});

describe('merchantInitials', () => {
  it('uses two letters from multi-word names', () => {
    expect(merchantInitials('Hill Country Outfitters')).toBe('HC');
  });

  it('uses two letters from a single word', () => {
    expect(merchantInitials('Amazon')).toBe('AM');
  });
});
