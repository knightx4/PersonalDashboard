import { describe, expect, it } from 'vitest';
import { parseMerchantId } from './user-merchants';

describe('parseMerchantId', () => {
  it('accepts a UUID', () => {
    expect(parseMerchantId('32f5d8f5-52fb-4b2f-8f97-bd8d9198ffe6')).toBe(
      '32f5d8f5-52fb-4b2f-8f97-bd8d9198ffe6',
    );
  });

  it('rejects empty or malformed values', () => {
    expect(parseMerchantId(undefined)).toBeUndefined();
    expect(parseMerchantId('')).toBeUndefined();
    expect(parseMerchantId('amazon')).toBeUndefined();
    expect(parseMerchantId('not-a-uuid')).toBeUndefined();
  });
});
